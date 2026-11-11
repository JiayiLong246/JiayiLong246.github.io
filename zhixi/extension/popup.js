const status = document.getElementById('status');
const fields = ['box', 'title', 'options', 'answer', 'submit', 'retry'];
function settings() { return Object.fromEntries(fields.map(name => [name, document.getElementById(name).value.trim()])); }
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
async function currentTab() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.url || !['https://zhdj.hnust.edu.cn', 'https://webvpn.hnust.edu.cn'].includes(new URL(tab.url).origin)) throw new Error('请打开学校练习页面后再操作');
  return tab;
}
async function findFrame(tab, config) {
  const frames = await chrome.scripting.executeScript({
    target: {tabId: tab.id, allFrames: true},
    func: selector => document.querySelectorAll(selector).length,
    args: [config.box]
  });
  const candidates = [];
  for (const frame of frames.filter(frame => frame.result > 0)) {
    try {
      const result = await chrome.tabs.sendMessage(tab.id, {action: 'probe', settings: config}, {frameId: frame.frameId});
      if (result.ok && result.value.count > 0) candidates.push(frame.frameId);
    } catch (_) { /* Report unavailable collectors below. */ }
  }
  if (candidates.length !== 1) throw new Error(candidates.length ? '多个框架包含题目，请只展开本轮练习后重试' : '未找到题目。请刷新学校页面、展开题目再试。仍失败时，需要练习页和答案页 HTML 样本以适配。');
  return candidates[0];
}
async function action(name, submit = false) {
  if (name === 'start' && !document.getElementById('practice').checked) throw new Error('请先勾选确认当前为考试练习');
  const config = settings();
  if (!config.box || !config.title || !config.options) throw new Error('题目、题干和选项选择器不能为空');
  const tab = await currentTab();
  const frameId = await findFrame(tab, config);
  if (name === 'start') {
    const rounds = Number(document.getElementById('rounds').value);
    if (submit && (!Number.isInteger(rounds) || rounds < 1 || rounds > 1000)) throw new Error('套数应为 1 到 1000 的整数');
    await chrome.storage.local.set({settings: config, rounds});
    await send({action: 'prepare', tabId: tab.id, frameId, settings: config, rounds, submit});
  }
  const result = await chrome.tabs.sendMessage(tab.id, {action: name, settings: config, submit}, {frameId});
  if (!result.ok) throw new Error(result.error);
  status.textContent = name === 'start' ? '任务已启动，请回到网页查看右下角进度。每套答案采集完整后自动点击重新练习，达到设定套数后停止。' : `已保存。累计 ${result.value.count} 题，有答案 ${result.value.answered} 题。`;
}
async function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  try { await chrome.downloads.download({url, filename, saveAs: true}); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 30000); }
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
async function exportRows(format) {
  const {questions = []} = await chrome.storage.local.get('questions');
  if (!questions.length) throw new Error('还没有采集题目');
  const name = `zhixi-questions-${new Date().toISOString().slice(0, 10)}`;
  if (format === 'json') {
    await download(JSON.stringify({version: 3, exportedAt: new Date().toISOString(), questions}, null, 2), `${name}.json`, 'application/json');
  } else {
    const content = questions.map((q, index) => {
      const answer = q.answer?.length ? q.answer.map(i => `${String.fromCharCode(65 + i)}. ${q.options[i]}`).join('；') : q.status === 'conflict' ? '答案存在冲突，待核对' : '待采集或核对';
      return `<article><h3>${index + 1}. ${escape(q.question)}</h3><ol type="A">${q.options.map(option => `<li>${escape(option)}</li>`).join('')}</ol><p class="answer">网站参考答案　${escape(answer)}</p>${q.rawAnswer ? `<p>网页答案原文　${escape(q.rawAnswer)}</p>` : ''}${q.note ? `<p>解析　${escape(q.note)}</p>` : ''}</article>`;
    }).join('');
    await download(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>知习题目与答案</title><style>body{font:16px/1.8 system-ui;max-width:900px;margin:32px auto;padding:0 20px;color:#243b36}article{border-bottom:1px solid #ddd;padding:12px 0;break-inside:avoid}h3{font-size:18px}.answer{color:#176c59}p{white-space:pre-wrap}@media print{body{margin:0}}</style><h1>知习题目与答案</h1><p>共 ${questions.length} 题。答案取自练习反馈，未识别及冲突题保留待核对状态。可使用浏览器打印功能保存 PDF。</p>${content}</html>`, `${name}.html`, 'text/html');
  }
  status.textContent = '已导出。请保留 JSON 备份。';
}
async function exportDiagnostics() {
  const frameResults = [];
  let tab;
  try {
    tab = await currentTab();
    const frames = await chrome.scripting.executeScript({
      target: {tabId: tab.id, allFrames: true}, func: () => true
    });
    for (const frame of frames) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {action: 'diagnose', settings: settings()}, {frameId: frame.frameId});
        frameResults.push({frameId: frame.frameId, response});
      } catch (error) {
        frameResults.push({frameId: frame.frameId, error: error.message});
      }
    }
  } catch (error) { frameResults.push({error: error.message}); }
  const {diagnosticLogs = [], diagnosticSnapshots = [], questions = []} = await chrome.storage.local.get(['diagnosticLogs', 'diagnosticSnapshots', 'questions']);
  const job = tab ? (await chrome.storage.session.get(`job-${tab.id}`))[`job-${tab.id}`] : null;
  const report = {
    schemaVersion: 1,
    extensionVersion: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    settings: settings(), frameResults, job: job || null,
    totals: {
      questions: questions.length, answered: questions.filter(q => q.answer?.length).length,
      conflicts: questions.filter(q => q.status === 'conflict').length
    },
    logs: diagnosticLogs,
    snapshots: diagnosticSnapshots,
    storedQuestions: questions.map(q => ({
      question: q.question, type: q.type, options: q.options,
      answer: q.answer || null, rawAnswer: q.rawAnswer || '',
      status: q.status, answerCandidates: q.answerCandidates || null
    }))
  };
  await download(JSON.stringify(report, null, 2), `zhixi-diagnostic-${Date.now()}.json`, 'application/json');
  status.textContent = '诊断日志已导出。请把 zhixi-diagnostic 开头的 JSON 文件发给我。';
}
function bind(id, callback) {
  document.getElementById(id).onclick = async () => {
    const button = document.getElementById(id);
    button.disabled = true;
    try { await callback(); } catch (error) {
      status.textContent = error.message;
      try { await send({action: 'log', event: 'popup_error', details: {button: id, message: error.message, stack: error.stack, settings: settings()}}); } catch (_) {}
    }
    finally { button.disabled = false; }
  };
}
bind('run', () => action('start', true));
bind('fill', () => action('start', false));
bind('capture', () => action('capture'));
bind('stop', async () => { const tab = await currentTab(); await send({action: 'stop', tabId: tab.id}); status.textContent = '已停止本页任务。已提交的练习记录会保留。'; });
bind('settings', async () => { await chrome.storage.local.set({settings: settings()}); status.textContent = '设置已保存'; });
async function githubStatus() {
  const data = await chrome.storage.local.get(['githubSyncEnabled', 'githubSyncStatus', 'githubToken']);
  document.getElementById('github-auto').checked = !!data.githubSyncEnabled;
  document.getElementById('github-token').placeholder = data.githubToken ? '已保存，留空可继续使用原凭据' : '仅在此扩展中填写并保存';
  document.getElementById('github-status').textContent = data.githubSyncStatus?.message || (data.githubToken ? '已配置，点击立即同步可测试' : '尚未配置');
}
bind('github-save', async () => {
  const granted = await chrome.permissions.request({origins: ['https://api.github.com/*']});
  if (!granted) throw new Error('需要允许插件访问 GitHub API 才能同步');
  await send({action: 'githubConfigure', token: document.getElementById('github-token').value, enabled: document.getElementById('github-auto').checked});
  document.getElementById('github-token').value = '';
  await githubStatus();
  status.textContent = 'GitHub 同步配置已保存，请点击立即同步累计题库';
});
bind('github-sync', async () => {await send({action: 'githubSync'}); await githubStatus();});
bind('github-forget', async () => {await send({action: 'githubForget'}); await githubStatus();});
githubStatus().catch(() => {});
bind('logs', exportDiagnostics);
bind('clearLogs', async () => {await send({action: 'clearLogs'}); status.textContent = '诊断日志已清空，题库记录已保留。';});
bind('json', () => exportRows('json'));
bind('html', () => exportRows('html'));
async function renderStatus() {
  const {questions = []} = await chrome.storage.local.get('questions');
  let text = `累计 ${questions.length} 题，有网站参考答案 ${questions.filter(q => q.answer?.length).length} 题。`;
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (tab) {
    const job = (await chrome.storage.session.get(`job-${tab.id}`))[`job-${tab.id}`];
    if (job) text += `\n已完成 ${job.completed} / ${job.target} 套\n${job.message}`;
  }
  status.textContent = text;
}
chrome.storage.local.get(['settings', 'rounds']).then(async data => {
  for (const [name, value] of Object.entries(data.settings || {})) if (fields.includes(name)) document.getElementById(name).value = value;
  if (data.rounds) document.getElementById('rounds').value = data.rounds;
  await renderStatus();
}).catch(error => {status.textContent = error.message;});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.githubSyncStatus || changes.githubSyncEnabled)) githubStatus().catch(() => {});
  if (area === 'session' || (area === 'local' && changes.questions)) renderStatus().catch(() => {});
});
