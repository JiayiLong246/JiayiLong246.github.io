/* Shared by the collector and the background worker. */
globalThis.Zhixi = (() => {
  const clean = value => String(value || '').replace(/\s+/g, '').normalize('NFKC');
  const optionText = value => String(value || '').replace(/^\s*[A-Z][.．、:：)）]\s*/i, '').trim();
  function titleParts(title, hint = '') {
    const question = title.replace(/^\s*\d+\s*[.．、)）]\s*/, '').trim();
    const type = [question, hint].join(' ').match(/单选题|多选题|判断题/);
    return {question, type: type ? type[0] : '', stem: question.replace(/^[【\[（(]?(单选题|多选题|判断题)[】\]）)]?\s*/, '').trim()};
  }
  function key(q) {
    const parts = titleParts(q.question, q.type);
    return JSON.stringify([q.type || parts.type, clean(parts.stem), q.options.map(clean).sort()]);
  }
  function parseAnswer(raw, options, type) {
    const value = String(raw || '').normalize('NFKC').trim();
    let answer;
    if (/^[A-Z](?:[\s,，、;/和与]*[A-Z])*[.。]?$/i.test(value)) {
      answer = [...new Set((value.toUpperCase().match(/[A-Z]/g) || []).map(letter => letter.charCodeAt(0) - 65))];
    } else {
      const exact = options.map((option, index) => clean(option) === clean(value) ? index : -1).filter(index => index >= 0);
      if (exact.length === 1) answer = exact;
      if (!answer && type === '多选题') {
        const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const mapped = lines.map(line => options.map((option, index) => clean(option) === clean(line) ? index : -1).filter(index => index >= 0));
        if (lines.length > 1 && mapped.every(matches => matches.length === 1)) {
          const indices = mapped.map(matches => matches[0]);
          if (new Set(indices).size === indices.length) answer = indices;
        }
      }
      if (!answer && type === '判断题') {
        const synonyms = [['正确', '对', '是', '√', 'true'], ['错误', '错', '否', '×', 'false']];
        const group = synonyms.find(words => words.includes(value.toLowerCase()));
        if (group) answer = options.map((option, index) => group.includes(clean(option).toLowerCase()) ? index : -1).filter(index => index >= 0);
      }
    }
    if (!answer?.length || answer.some(index => index >= options.length) || (type !== '多选题' && answer.length !== 1)) return null;
    return answer.sort((a, b) => a - b);
  }
  function readAnswer(box, selector, isVisible) {
    const labelPattern = /^(?:正确答案|参考答案|标准答案|答案)\s*[:：]\s*$/;
    const stripLabel = text => String(text || '').replace(/^(?:正确答案|参考答案|标准答案|答案)\s*[:：]\s*/, '').trim();
    function fieldText(element) {
      if (!element) return '';
      const field = element.matches('textarea,input') ? element : element.querySelector('textarea,input[type=text]');
      return stripLabel(field ? field.value : element.innerText);
    }
    if (selector) return fieldText(box.querySelector(selector));
    const inline = box.innerText.match(/(?:^|\n)\s*(?:正确答案|参考答案|标准答案|答案)\s*[:：][ \t]*([^\r\n]+)/);
    if (inline) return stripLabel(inline[1]);
    const choiceInputs = [...box.querySelectorAll('input[type=radio],input[type=checkbox]')];
    const submitted = choiceInputs.length > 0 && choiceInputs.every(input => input.disabled);
    const labels = [...box.querySelectorAll('*')].filter(element => isVisible(element) && labelPattern.test(element.textContent.trim()));
    const candidates = [];
    for (const label of labels) {
      // Stay within this question and pair the answer label with its nearest field.
      let parent = label;
      while (parent) {
        const fields = [...parent.querySelectorAll('textarea,input[type=text]')].filter(isVisible);
        if (fields.length > 1) break;
        if (fields.length === 1) {
          const field = fields[0];
          if (field.disabled || field.readOnly || submitted) {
            const value = fieldText(field);
            if (value) candidates.push(value);
          }
          break;
        }
        if (parent === box) break;
        parent = parent.parentElement;
      }
    }
    const unique = [...new Set(candidates)];
    return unique.length === 1 ? unique[0] : '';
  }
  function merge(oldRows, incoming) {
    const rows = structuredClone(oldRows);
    const seen = new Map(rows.map(q => [key(q), q]));
    for (const source of incoming) {
      const q = structuredClone(source);
      const id = key(q);
      const existing = seen.get(id);
      if (!existing) {
        rows.push(q);
        seen.set(id, q);
        continue;
      }
      const candidate = q.answer?.map(index => existing.options.findIndex(option => clean(option) === clean(q.options[index]))).sort((a, b) => a - b);
      if (candidate?.length && candidate.every(index => index >= 0)) {
        if (existing.status === 'conflict' || (existing.answer && JSON.stringify(existing.answer) !== JSON.stringify(candidate))) {
          existing.answerCandidates = [...new Map([...(existing.answerCandidates || []), existing.answer, candidate].filter(Boolean).map(value => [JSON.stringify(value), value])).values()];
          delete existing.answer;
          existing.status = 'conflict';
        } else {
          existing.answer = candidate;
          existing.status = 'website-reference';
        }
      }
      if (q.rawAnswer) existing.rawAnswer = q.rawAnswer;
      if (q.note) existing.note = q.note;
      existing.lastSeen = q.lastSeen;
    }
    return rows;
  }
  return {clean, optionText, titleParts, key, parseAnswer, readAnswer, merge};
})();
