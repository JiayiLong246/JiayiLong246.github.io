const githubTarget = {
  owner: 'JiayiLong246', repo: 'JiayiLong246.github.io', branch: 'master',
  path: 'zhixi/questions.json', site: 'https://jiayilong246.github.io/zhixi/'
};
let githubSyncRunning;
function encodeUtf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
function decodeUtf8(value) {
  return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g, '')), char => char.charCodeAt(0)));
}
async function githubRequest(token, path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${githubTarget.owner}/${githubTarget.repo}/${path}`, {
    ...options,
    headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...options.headers},
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    const error = new Error(`GitHub 请求失败（${response.status}）。请检查凭据、仓库权限或稍后重试。`);
    error.status = response.status;
    throw error;
  }
  return response;
}
async function scheduleGithubSync() {
  const data = await chrome.storage.local.get(['githubSyncEnabled', 'githubSyncRevision']);
  if (!data.githubSyncEnabled) return;
  await chrome.storage.local.set({githubSyncRevision: (data.githubSyncRevision || 0) + 1, githubSyncPending: true});
  await chrome.alarms.create('zhixi-github-sync', {when: Date.now() + 10000});
}
async function syncGithub() {
  if (githubSyncRunning) return githubSyncRunning;
  githubSyncRunning = performGithubSync();
  try { return await githubSyncRunning; }
  finally { githubSyncRunning = null; }
}
async function performGithubSync() {
  const started = Date.now();
  try {
    const data = await chrome.storage.local.get(['githubToken', 'githubSyncRevision', 'questions']);
    if (!data.githubToken) throw new Error('请先在插件中保存 GitHub 同步凭据');
    const permitted = await chrome.permissions.contains({origins: ['https://api.github.com/*']});
    if (!permitted) throw new Error('尚未允许访问 GitHub API，请重新保存同步配置');
    const localRows = data.questions || [];
    if (!localRows.length) throw new Error('还没有采集题目');
    await chrome.storage.local.set({githubSyncStatus: {state: 'syncing', at: new Date().toISOString(), message: '正在同步 GitHub 公开题库'}});
    const contentPath = `contents/${githubTarget.path}`;
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      let metadata;
      let payload = {questions: []};
      try {
        metadata = await (await githubRequest(data.githubToken, `${contentPath}?ref=${encodeURIComponent(githubTarget.branch)}`)).json();
        if (metadata.size > 5 * 1024 * 1024) throw new Error('远端题库超过同步大小限制');
        if (metadata.content) payload = JSON.parse(decodeUtf8(metadata.content));
        else payload = await (await githubRequest(data.githubToken, `${contentPath}?ref=${encodeURIComponent(githubTarget.branch)}`, {headers: {Accept: 'application/vnd.github.raw+json'}})).json();
      } catch (error) { if (error.status !== 404) throw error; }
      const questions = await ZhixiPublish.mergePublic(payload, localRows);
      if (JSON.stringify(ZhixiPublish.rowsFrom(payload)) === JSON.stringify(questions)) {
        result = {unchanged: true, count: questions.length};
        break;
      }
      try {
        const updated = await (await githubRequest(data.githubToken, contentPath, {
          method: 'PUT', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            message: `Update Zhixi question bank (${questions.length} questions)`,
            branch: githubTarget.branch, ...(metadata?.sha ? {sha: metadata.sha} : {}),
            content: encodeUtf8(JSON.stringify({schema: 1, updatedAt: new Date().toISOString(), questions}, null, 2))
          })
        })).json();
        result = {count: questions.length, commit: updated.commit?.sha};
        break;
      } catch (error) { if (![409, 422].includes(error.status) || attempt === 2) throw error; }
    }
    const status = {state: 'success', at: new Date().toISOString(), ...result, message: result.unchanged ? `公开题库已是最新，共 ${result.count} 题` : `已同步 ${result.count} 题，网页稍后会提示更新`};
    const latest = await chrome.storage.local.get('githubSyncRevision');
    const pending = (latest.githubSyncRevision || 0) !== (data.githubSyncRevision || 0);
    await chrome.storage.local.set({githubSyncStatus: status, githubSyncPending: pending});
    if (pending) await chrome.alarms.create('zhixi-github-sync', {when: Date.now() + 10000});
    await record('github_sync_completed', {count: result.count, unchanged: !!result.unchanged, durationMs: Date.now() - started});
    return status;
  } catch (error) {
    const message = error.name === 'TimeoutError' ? 'GitHub 同步超时，请稍后点击立即同步重试' : error.message;
    await chrome.storage.local.set({githubSyncStatus: {state: 'error', at: new Date().toISOString(), message}, githubSyncPending: true});
    await record('github_sync_error', {message});
    throw new Error(message);
  }
}
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'zhixi-github-sync') syncGithub().catch(() => {});
});
chrome.runtime.onStartup.addListener(async () => {
  const {githubSyncPending, githubSyncEnabled} = await chrome.storage.local.get(['githubSyncPending', 'githubSyncEnabled']);
  if (githubSyncPending && githubSyncEnabled) await chrome.alarms.create('zhixi-github-sync', {when: Date.now() + 15000});
});
