(() => {
  if (globalThis.zhixiCollector) return;
  globalThis.zhixiCollector = true;
  const defaults = {box: '.question-list-box', title: '.name', options: '.el-radio__label,.el-checkbox__label', answer: '', submit: ''};
  let running = false;
  const phaseTimeout = 180000;
  let lastAnswerSignature = '';
  let lastSnapshotAt = 0;
  const visible = element => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden],[aria-hidden="true"]');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function send(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }
  async function trace(event, details = {}) {
    try { await send({action: 'log', event, details}); }
    catch (_) { /* Diagnostics must not interrupt collection. */ }
  }
  function buttonDetails(element) {
    return {
      tag: element.tagName, className: String(element.className || '').slice(0, 300),
      text: (element.innerText || element.value || '').trim().slice(0, 120),
      visible: visible(element), disabled: !!element.disabled
    };
  }
  function questionTree(root) {
    let remaining = 140;
    function visit(element, depth) {
      if (remaining-- <= 0 || depth > 7) return {truncated: true};
      const tag = (element.tagName || '').toLowerCase();
      if (['script', 'style', 'iframe'].includes(tag) || (tag === 'input' && ['hidden', 'password', 'email'].includes(element.type))) return null;
      const result = {tag, className: String(element.className || '').slice(0, 200), visible: visible(element)};
      if (tag === 'input' || tag === 'textarea') {
        result.type = element.type;
        result.disabled = !!element.disabled;
        result.readOnly = !!element.readOnly;
        result.checked = !!element.checked;
        if (tag === 'textarea' || (tag === 'input' && element.type === 'text')) result.value = String(element.value || '').slice(0, 1800);
      }
      if (!element.children.length) result.text = (element.innerText || element.textContent || '').trim().slice(0, 1000);
      else result.children = [...element.children].map(child => visit(child, depth + 1)).filter(Boolean);
      return result;
    }
    return visit(root, 0);
  }
  async function diagnose(settings, reason) {
    try {
      let items = [];
      let error = '';
      try { items = collect(settings); } catch (failure) { error = failure.message; }
      const limited = items.slice(0, 300);
      const failed = limited.filter(item => !item.q.answer?.length);
      const successful = limited.filter(item => item.q.answer?.length);
      const sampleItems = [...failed.slice(0, 6), ...successful.slice(0, 2)];
      const config = {...defaults, ...settings};
      const fallback = sampleItems.length ? [] : [...document.querySelectorAll(defaults.box)].slice(0, 2).map(box => ({box}));
      const snapshot = {
        at: new Date().toISOString(), reason, page: location.origin + location.pathname,
        settings: config, error, recognized: items.length,
        parsed: items.filter(item => item.q.answer?.length).length,
        rawAnswers: items.filter(item => item.q.rawAnswer).length,
        containerCount: error ? null : document.querySelectorAll(config.box).length,
        pageTextareaCount: document.querySelectorAll('textarea').length,
        buttons: [...document.querySelectorAll('button,input[type=submit],a.el-button')].map(buttonDetails).filter(button => /提交|核对|练习|确认|确定|交卷/.test(button.text)).slice(0, 30),
        questions: limited.map(({q}) => ({
          question: q.question.slice(0, 1800), type: q.type,
          options: q.options.map(option => option.slice(0, 1200)),
          rawAnswer: q.rawAnswer.slice(0, 2500), answer: q.answer || null,
          status: q.status
        })),
        domSamples: [...sampleItems, ...fallback].map(item => ({
          question: item.q?.question.slice(0, 600) || '',
          fields: [...item.box.querySelectorAll('textarea,input[type=text]')].slice(0, 8).map(field => ({
            tag: field.tagName, className: String(field.className || ''),
            value: String(field.value || '').slice(0, 2500),
            text: (field.textContent || '').slice(0, 2500),
            disabled: !!field.disabled, readOnly: !!field.readOnly, visible: visible(field)
          })),
          structure: questionTree(item.box)
        }))
      };
      // Keep large pages bounded while retaining the problematic question structures.
      while (JSON.stringify(snapshot).length > 220000 && snapshot.questions.length) snapshot.questions.pop();
      while (JSON.stringify(snapshot).length > 220000 && snapshot.domSamples.length) snapshot.domSamples.pop();
      await send({action: 'diagnostic', snapshot});
      return {recognized: snapshot.recognized, parsed: snapshot.parsed, rawAnswers: snapshot.rawAnswers};
    } catch (error) {
      await trace('snapshot_error', {reason, message: error.message, stack: error.stack});
      return {error: error.message};
    }
  }
  function banner(text) {
    let element = document.getElementById('zhixi-collector-status');
    if (!element) {
      element = document.createElement('div');
      element.id = 'zhixi-collector-status';
      element.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;max-width:420px;padding:14px 18px;background:#173e3b;color:white;border-radius:10px;font:14px/1.7 sans-serif;box-shadow:0 4px 24px #0004;white-space:pre-wrap';
      document.documentElement.append(element);
    }
    element.textContent = text;
  }
  function collect(settings) {
    const config = {...defaults, ...settings};
    return [...document.querySelectorAll(config.box)].filter(visible).flatMap(box => {
      const title = box.querySelector(config.title);
      if (!visible(title)) return [];
      const inputs = [...box.querySelectorAll('input[type=radio],input[type=checkbox]')];
      let options = [...box.querySelectorAll(config.options)].filter(visible);
      const parts = Zhixi.titleParts(title.innerText, box.innerText.match(/单选题|多选题|判断题/)?.[0] || '');
      if (!parts.type && inputs.length) parts.type = inputs.some(input => input.type === 'checkbox') ? '多选题' : '单选题';
      const labels = options.map(option => Zhixi.optionText(option.innerText));
      if (!parts.type && labels.length === 2 && labels.every(label => /^(正确|错误|对|错|是|否)$/.test(label))) parts.type = '判断题';
      if (parts.type === '单选题' && labels.length === 2 && labels.every(label => /^(正确|错误|对|错|是|否)$/.test(label))) parts.type = '判断题';
      if (!parts.question || labels.length < 2 || new Set(labels.map(Zhixi.clean)).size !== labels.length) return [];
      const rawAnswer = Zhixi.readAnswer(box, config.answer, visible);
      const answer = Zhixi.parseAnswer(rawAnswer, labels, parts.type);
      const note = box.innerText.match(/(?:答案解析|试题解析|解析)\s*[:：]\s*([\s\S]*)/)?.[1]?.trim() || '';
      const q = {question: parts.question, type: parts.type, options: labels, rawAnswer, note, status: 'pending', source: location.origin + location.pathname, lastSeen: new Date().toISOString()};
      if (answer) { q.answer = answer; q.status = 'website-reference'; }
      return [{q, box, options}];
    });
  }
  async function save(settings) {
    const items = collect(settings);
    if (!items.length) throw new Error('未识别到题目。请展开题目，或在插件“高级设置”里调整选择器。');
    const counts = await send({action: 'save', questions: items.map(item => item.q)});
    return {items, counts};
  }
  function uniqueButton(selector, pattern) {
    const elements = selector ? [...document.querySelectorAll(selector)] : [...document.querySelectorAll('button,input[type=submit],a.el-button')];
    const matches = elements.filter(element => visible(element) && !element.disabled && (selector || pattern.test((element.innerText || element.value || '').trim())));
    if (matches.length !== 1) {
      trace('button_match_failed', {selector: selector || '', pattern: pattern.source, matches: matches.map(buttonDetails), candidates: elements.map(buttonDetails).filter(button => /提交|核对|练习|确认|确定|交卷/.test(button.text)).slice(0, 25)});
      throw new Error('未找到唯一可用的操作按钮，请检查页面或高级设置');
    }
    trace('button_matched', {pattern: pattern.source, selector: selector || '', button: buttonDetails(matches[0])});
    return matches[0];
  }
  function choiceInput(option) {
    return (option.closest('label') || option).querySelector('input');
  }
  function editable(items) {
    return items.length > 0 && items.every(item => item.options.every(option => {
      const input = choiceInput(option);
      return input && !input.disabled;
    }));
  }
  async function activeJob(runId) {
    const job = await send({action: 'jobGet'});
    if (!job || job.runId !== runId) throw new Error('任务已停止或已被替换');
    return job;
  }
  async function update(job, patch) {
    await send({action: 'jobSet', runId: job.runId, patch});
    return {...job, ...patch};
  }
  async function phase(job, stage, patch = {}) {
    return update(job, {stage, phaseAt: Date.now(), ...patch});
  }
  function progress(job, text) {
    banner(`已完成 ${job.completed} / ${job.target} 套\n累计 ${job.counts.count} 题，有答案 ${job.counts.answered} 题\n${text}`);
  }
  async function randomFill(items, job) {
    if (!editable(items)) throw new Error('题目控件已禁用或无法识别，已停止自动操作');
    for (const {options, q} of items) {
      await activeJob(job.runId);
      const chosen = Math.floor(Math.random() * options.length);
      for (let index = 0; index < options.length; index++) {
        const input = choiceInput(options[index]);
        const wanted = index === chosen;
        if (input.type === 'checkbox' ? input.checked !== wanted : wanted && !input.checked) {
          (options[index].closest('label') || options[index]).click();
          await wait(70);
        }
      }
      if (options.filter(option => choiceInput(option)?.checked).length !== 1) throw new Error(`作答未生效，已停止提交。题目 ${q.question.slice(0, 35)}`);
    }
    await activeJob(job.runId);
  }
  async function beginNext(job) {
    const button = uniqueButton(job.settings.retry, /^(重新练习|再练一次|重新开始练习)$/);
    // Save before clicking. A page reload resumes waiting without clicking twice.
    job = await phase(job, 'next', {message: '已保存本套答案，正在等待下一套题目'});
    progress(job, job.message);
    await trace('retry_click', {completed: job.completed, target: job.target, button: buttonDetails(button)});
    button.click();
  }
  async function confirmSubmission(job) {
    if (!job.submit || job.confirmed) return;
    const dialogs = [...document.querySelectorAll('[role=dialog],.el-message-box')].filter(element => visible(element) && /提交|交卷|核对/.test(element.innerText));
    const buttons = [...new Set(dialogs.flatMap(dialog => [...dialog.querySelectorAll('button')]))].filter(button => visible(button) && !button.disabled && /^(确定|确认|确认提交|确定提交|确定交卷)$/.test(button.innerText.trim()));
    if (buttons.length === 1) {
      await update(job, {confirmed: true});
      buttons[0].click();
    }
  }
  async function run() {
    if (running) return;
    running = true;
    let job;
    try {
      job = await send({action: 'jobGet'});
      if (!job || ['done', 'error'].includes(job.stage)) return;
      await trace('controller_started', {runId: job.runId, stage: job.stage, completed: job.completed, target: job.target});
      await diagnose(job.settings, 'controller_started');
      const runId = job.runId;
      while (true) {
        job = await activeJob(runId);
        if (['done', 'error'].includes(job.stage)) return;
        if (Date.now() - job.phaseAt > phaseTimeout) throw new Error('等待页面超时。请检查未显示或未识别的答案、登录状态或确认弹窗，再重新启动。');
        const items = collect(job.settings);
        const rows = items.map(item => item.q);
        const completeResults = rows.length > 0 && rows.every(q => q.answer?.length);
        if (job.stage === 'ready') {
          if (rows.some(q => q.rawAnswer)) {
            const counts = await send({action: 'save', questions: rows});
            job = await update(job, {counts, message: `已补采当前答案页 ${rows.filter(q => q.answer?.length).length} / ${rows.length} 题`});
            progress(job, job.message);
            if (completeResults) {
              if (job.submit) await beginNext(job);
              else throw new Error('当前是答案页，请开始新练习后再选择随机作答');
            }
          } else if (editable(items)) {
            if (items.some(item => !item.q.type)) throw new Error('部分题型无法识别，已停止自动操作');
            const counts = await send({action: 'save', questions: rows});
            job = await phase(job, 'filling', {counts, expectedKeys: [...new Set(rows.map(Zhixi.key))], questionCount: rows.length, confirmed: false, capturedKeys: [], message: '正在随机作答'});
          }
        } else if (job.stage === 'filling') {
          if (JSON.stringify([...new Set(rows.map(Zhixi.key))]) !== JSON.stringify(job.expectedKeys)) throw new Error('作答期间题目发生变化，已停止自动操作');
          progress(job, `正在作答第 ${job.completed + 1} 套，共 ${rows.length} 题`);
          await trace('fill_started', {round: job.completed + 1, questions: rows.length});
          await randomFill(items, job);
          await trace('fill_finished', {round: job.completed + 1, questions: rows.length});
          const button = job.submit ? uniqueButton(job.settings.submit, /^(提交|提交试卷|提交答案|提交练习|交卷|我要交卷|核对答案)$/) : null;
          job = await phase(job, 'answers', {message: job.submit ? '已点击核对答案，等待网站反馈' : '已随机作答，请手动点击核对答案'});
          progress(job, job.message);
          if (button) {
            await trace('submit_click', {round: job.completed + 1, button: buttonDetails(button)});
            button.click();
          }
        } else if (job.stage === 'answers') {
          await confirmSubmission(job);
          const signature = JSON.stringify(rows.map(q => [Zhixi.key(q), q.rawAnswer, q.answer]));
          if ((signature !== lastAnswerSignature && Date.now() - lastSnapshotAt >= 3000) || !lastAnswerSignature) {
            lastAnswerSignature = signature;
            lastSnapshotAt = Date.now();
            await diagnose(job.settings, 'answer_page_changed');
          }
          if (rows.length) {
            const counts = await send({action: 'save', questions: rows});
            const capturedKeys = [...new Set([...(job.capturedKeys || []), ...rows.filter(q => q.answer?.length).map(Zhixi.key)])];
            const answered = job.expectedKeys.filter(key => capturedKeys.includes(key)).length;
            job = await update(job, {counts, capturedKeys, message: `本套答案已采集 ${answered} / ${job.expectedKeys.length} 题`});
            progress(job, job.message);
            if (job.expectedKeys.length > 0 && answered === job.expectedKeys.length) {
              await diagnose(job.settings, 'round_answers_saved');
              job = await phase(job, 'saved', {completed: job.completed + 1, message: '本套答案已保存'});
            }
          }
        } else if (job.stage === 'saved') {
          if (job.completed >= job.target || !job.submit) {
            job = await phase(job, 'done', {message: '已达到设定套数，任务完成。可以导出题库。'});
            progress(job, job.message);
            return;
          }
          progress(job, '本套答案已保存，稍后开始下一套');
          // Leave a short interval between sets. Check cancellation before clicking.
          if (Date.now() - job.phaseAt >= 3000) await beginNext(job);
        } else if (job.stage === 'next') {
          progress(job, '等待新题目加载');
          // Freshly rendered controls and cleared answers also allow identical random sets.
          if (editable(items) && rows.every(q => !q.rawAnswer)) {
            await trace('new_questions_ready', {questions: rows.length, completed: job.completed});
            job = await phase(job, 'ready', {expectedKeys: [], capturedKeys: [], message: '新一套题目已加载'});
          }
        }
        await wait(1000);
      }
    } catch (error) {
      await trace('controller_error', {message: error.message, stack: error.stack, stage: job?.stage, completed: job?.completed, target: job?.target});
      if (job) {
        await diagnose(job.settings, 'controller_error');
        try {
          job = await phase(job, 'error', {message: error.message});
          progress(job, `自动操作已停止。${error.message}`);
        } catch (_) { banner('任务已停止。已采集的题目仍保存在插件中。'); }
      } else banner(error.message);
    } finally { running = false; }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    const execute = async () => {
      if (message.action === 'diagnose') return diagnose(message.settings, 'user_export');
      if (message.action === 'probe') return {count: collect(message.settings).length};
      if (message.action === 'capture') {
        const {items, counts} = await save(message.settings);
        await diagnose(message.settings, 'manual_capture');
        banner(`已保存 ${items.length} 题，累计 ${counts.count} 题，有答案 ${counts.answered} 题。`);
        return counts;
      }
      if (message.action === 'start') {
        run();
        return {started: true};
      }
    };
    execute().then(value => respond({ok: true, value}), error => respond({ok: false, error: error.message}));
    return true;
  });
  run();
})();
