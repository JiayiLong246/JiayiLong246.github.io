importScripts('core.js', 'publish.js', 'github-sync.js');
if (chrome.storage.local.setAccessLevel) chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}).catch(() => {});
let queue = Promise.resolve();
let answersReparsed = false;
let logQueue = Promise.resolve();
function record(event, details = {}, sender = {}) {
  const result = logQueue.then(() => appendLog(event, details, sender));
  logQueue = result.catch(() => {});
  return result;
}
async function appendLog(event, details = {}, sender = {}) {
  const data = await chrome.storage.local.get('diagnosticLogs');
  const logs = data.diagnosticLogs || [];
  const serialized = JSON.stringify(details);
  const entry = {
    at: new Date().toISOString(), event,
    tabId: sender.tab?.id ?? details.tabId ?? null,
    frameId: sender.frameId ?? null,
    details: serialized.length <= 16000 ? details : {truncated: true, preview: serialized.slice(0, 16000)}
  };
  logs.push(entry);
  let size = logs.reduce((sum, log) => sum + JSON.stringify(log).length, 0);
  while (logs.length > 500 || size > 500000) size -= JSON.stringify(logs.shift()).length;
  await chrome.storage.local.set({diagnosticLogs: logs});
}
async function repairPendingAnswers() {
  const {questions = []} = await chrome.storage.local.get('questions');
  let repaired = 0;
  for (const question of questions) {
    if (question.answer?.length || question.status === 'conflict' || !question.rawAnswer) continue;
    const type = question.type || Zhixi.titleParts(question.question).type;
    const answer = Zhixi.parseAnswer(question.rawAnswer, question.options, type);
    if (answer) {
      question.answer = answer;
      question.status = 'website-reference';
      repaired++;
    }
  }
  if (repaired) {
    await chrome.storage.local.set({questions});
    await record('stored_answers_repaired', {repaired, count: questions.length, answered: questions.filter(q => q.answer?.length).length});
  }
}
async function handle(message, sender) {
  if (!answersReparsed) {
    await repairPendingAnswers();
    answersReparsed = true;
  }

  if (message.action === 'githubConfigure') {
    const {githubToken} = await chrome.storage.local.get('githubToken');
    const token = message.token?.trim() || githubToken;
    if (!token) throw new Error('请输入 GitHub fine-grained token');
    await chrome.storage.local.set({githubToken: token, githubSyncEnabled: !!message.enabled});
    if (!message.enabled) await chrome.alarms.clear('zhixi-github-sync');
    return {enabled: !!message.enabled, configured: true, target: githubTarget};
  }
  if (message.action === 'githubSync') return syncGithub();
  if (message.action === 'githubForget') {
    await chrome.storage.local.remove(['githubToken', 'githubSyncEnabled', 'githubSyncPending']);
    await chrome.alarms.clear('zhixi-github-sync');
    return true;
  }
  if (message.action === 'log') {
    await record(message.event, message.details || {}, sender);
    return true;
  }
  if (message.action === 'diagnostic') {
    const {diagnosticSnapshots = []} = await chrome.storage.local.get('diagnosticSnapshots');
    const snapshot = {...message.snapshot, tabId: sender.tab?.id ?? null, frameId: sender.frameId ?? null};
    const snapshots = diagnosticSnapshots.filter(item => item.tabId !== snapshot.tabId || item.frameId !== snapshot.frameId);
    snapshots.push(snapshot);
    await chrome.storage.local.set({diagnosticSnapshots: snapshots.slice(-5)});
    await record('page_snapshot', {reason: snapshot.reason, recognized: snapshot.recognized, parsed: snapshot.parsed, rawAnswers: snapshot.rawAnswers, error: snapshot.error}, sender);
    return true;
  }
  if (message.action === 'clearLogs') {
    await chrome.storage.local.remove(['diagnosticLogs', 'diagnosticSnapshots']);
    return true;
  }
  if (message.action === 'save') {
    if (!sender.tab || !Array.isArray(message.questions)) throw new Error('无效采集来源');
    const {questions = []} = await chrome.storage.local.get('questions');
    const merged = Zhixi.merge(questions, message.questions);
    await chrome.storage.local.set({questions: merged});
    const result = {count: merged.length, answered: merged.filter(q => q.answer?.length).length};
    const beforeAnswered = questions.filter(q => q.answer?.length).length;
    if (merged.length !== questions.length || result.answered !== beforeAnswered) {
      await record('save_result', {
        received: message.questions.length,
        rawAnswers: message.questions.filter(q => q.rawAnswer).length,
        parsedAnswers: message.questions.filter(q => q.answer?.length).length,
        added: merged.length - questions.length,
        answeredDelta: result.answered - beforeAnswered,
        conflicts: merged.filter(q => q.status === 'conflict').length,
        ...result
      }, sender);
    }
    return result;
  }
  if (message.action === 'jobGet') {
    const key = `job-${sender.tab.id}`;
    const data = await chrome.storage.session.get(key);
    const job = data[key];
    return job?.frameId === sender.frameId ? job : null;
  }
  if (message.action === 'jobSet') {
    const key = `job-${sender.tab.id}`;
    const data = await chrome.storage.session.get(key);
    if (data[key]?.frameId !== sender.frameId || data[key]?.runId !== message.runId) throw new Error('任务已停止或已被替换');
    const next = {...data[key], ...message.patch};
    await chrome.storage.session.set({[key]: next});
    if (next.stage !== data[key].stage || next.message !== data[key].message || next.completed !== data[key].completed) {
      await record('job_progress', {runId: next.runId, stage: next.stage, completed: next.completed, target: next.target, message: next.message, counts: next.counts}, sender);
    }
    if (next.stage === 'saved' && data[key].stage !== 'saved') await scheduleGithubSync();
    return true;
  }
  if (message.action === 'prepare') {
    const tab = await chrome.tabs.get(message.tabId);
    if (!['https://zhdj.hnust.edu.cn', 'https://webvpn.hnust.edu.cn'].includes(new URL(tab.url).origin)) throw new Error('请打开学校练习页面');
    const target = message.submit ? Number(message.rounds) : 1;
    if (!Number.isInteger(target) || target < 1 || target > 1000) throw new Error('套数应为 1 到 1000 的整数');
    const key = `job-${tab.id}`;
    const previous = (await chrome.storage.session.get(key))[key];
    if (previous && !['done', 'error'].includes(previous.stage)) throw new Error('已有任务，请先停止后重试');
    const now = Date.now();
    await chrome.storage.session.set({[key]: {
      runId: crypto.randomUUID(), frameId: message.frameId, stage: 'ready',
      started: now, phaseAt: now, settings: message.settings,
      submit: !!message.submit, target, completed: 0, expectedKeys: [],
      counts: {count: 0, answered: 0}, message: '正在启动练习采集'
    }});
    await record('job_started', {tabId: tab.id, frameId: message.frameId, target, submit: !!message.submit, settings: message.settings}, sender);
    return true;
  }
  if (message.action === 'stop') {
    const job = (await chrome.storage.session.get(`job-${message.tabId}`))[`job-${message.tabId}`];
    await record('job_stopped', {tabId: message.tabId, stage: job?.stage, completed: job?.completed}, sender);
    await chrome.storage.session.remove(`job-${message.tabId}`);
    return true;
  }
  throw new Error('未知操作');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  queue = queue.then(async () => {
    try {
      respond({ok: true, value: await handle(message, sender)});
    } catch (error) {
      try { await record('background_error', {action: message.action, message: error.message, stack: error.stack}, sender); }
      catch (_) { /* A full or unavailable storage area must still return the original failure. */ }
      respond({ok: false, error: error.message});
    }
  });
  queue = queue.catch(() => {});
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => chrome.storage.session.remove(`job-${tabId}`));
