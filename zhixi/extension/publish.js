/* Public question-bank conversion. Only study fields are published. */
globalThis.ZhixiPublish = (() => {
  function rowsFrom(payload) {
    const rows = Array.isArray(payload) ? payload : payload?.questions;
    if (!Array.isArray(rows)) throw new Error('远端题库格式无效，已停止同步');
    return rows;
  }
  function collector(row) {
    const question = row.question || row.stem || '';
    const type = row.type || Zhixi.titleParts(question).type;
    if (!question || !['单选题', '多选题', '判断题'].includes(type) || !Array.isArray(row.options) || row.options.length < 2 || row.options.some(option => typeof option !== 'string' || !option.trim())) throw new Error('题目字段不完整，已停止同步');
    let answer = row.answer;
    if (row.verified === false || row.status === 'conflict') answer = undefined;
    if (answer?.length && (!answer.every(i => Number.isInteger(i) && i >= 0 && i < row.options.length) || new Set(answer).size !== answer.length || (type !== '多选题' && answer.length !== 1))) throw new Error('题目答案下标无效，已停止同步');
    return {
      question, type, options: row.options, ...(answer?.length ? {answer} : {}),
      status: row.status === 'conflict' ? 'conflict' : answer?.length ? 'website-reference' : 'pending',
      note: typeof row.note === 'string' ? row.note : '',
      ...(row.answerCandidates ? {answerCandidates: row.answerCandidates} : {})
    };
  }
  async function mergePublic(remotePayload, incoming) {
    const remote = rowsFrom(remotePayload);
    const oldIds = new Map(remote.map(row => [Zhixi.key(collector(row)), {id: row.id, number: row.number}]));
    const incomingRows = incoming.map(collector);
    const merged = Zhixi.merge(remote.map(collector), incomingRows);
    const byKey = new Map(merged.map(row => [Zhixi.key(row), row]));
    for (const source of incomingRows.filter(row => row.status === 'conflict')) {
      const row = byKey.get(Zhixi.key(source));
      const candidates = (source.answerCandidates || []).map(answer => answer.map(index => row.options.findIndex(option => Zhixi.clean(option) === Zhixi.clean(source.options[index]))).sort((a, b) => a - b)).filter(answer => answer.length && answer.every(index => index >= 0));
      row.answerCandidates = [...new Map([...(row.answerCandidates || []), row.answer, ...candidates].filter(Boolean).map(answer => [JSON.stringify(answer), answer])).values()];
      delete row.answer;
      row.status = 'conflict';
    }
    let number = remote.reduce((max, row) => Math.max(max, Number(row.number) || 0), 0);
    const published = [];
    for (const row of merged) {
      const key = Zhixi.key(row);
      const original = oldIds.get(key);
      const digest = original?.id ? null : await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      const id = original?.id || [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
      const answer = row.answer || [];
      published.push({
        id, number: original?.number || ++number, type: row.type,
        stem: Zhixi.titleParts(row.question, row.type).stem,
        options: row.options, answer, verified: answer.length > 0,
        reference: answer.length ? answer.map(i => row.options[i]).join('；') : '待核对',
        note: row.status === 'conflict' ? '网站答案存在冲突，待核对。' : row.note,
        status: row.status === 'conflict' ? 'conflict' : answer.length ? 'reference' : 'pending',
        ...(row.answerCandidates ? {answerCandidates: row.answerCandidates} : {})
      });
    }
    return published;
  }
  return {mergePublic, rowsFrom};
})();
