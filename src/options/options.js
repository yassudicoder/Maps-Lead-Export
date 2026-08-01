/**
 * Options page.
 *
 * Currently one thing: the already-exported list, which is the only stored
 * state a user might reasonably want to inspect or throw away. It talks to the
 * worker over runtime.sendMessage rather than a port, because these are
 * one-shot commands rather than a subscription.
 */
(function (root) {
  'use strict';

  const MLE = root.MLE;
  const K = MLE.K;
  const T = MLE.text;

  const el = {};
  ['indexCount', 'downloadIndex', 'clearIndex', 'confirm', 'confirmText',
    'confirmNo', 'confirmYes', 'toast'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  let toastTimer = 0;
  let size = 0;

  function msg(key, subs) {
    try {
      return chrome.i18n.getMessage(key, subs) || '';
    } catch (_) {
      return '';
    }
  }

  function applyStaticText() {
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      const text = msg(node.getAttribute('data-i18n'));
      if (text) node.textContent = text;
    });
    document.title = msg('optionsTitle') || document.title;
  }

  function toast(text, tone) {
    el.toast.textContent = text;
    el.toast.dataset.tone = tone || '';
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.hidden = true;
    }, 3200);
  }

  function ask(type, payload) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), function (reply) {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(reply);
      });
    });
  }

  function renderStats() {
    return ask(K.MSG.INDEX_STATS).then(function (reply) {
      size = (reply && reply.size) || 0;
      const max = (reply && reply.max) || K.EXPORTED_INDEX_MAX;
      el.indexCount.textContent = size
        ? msg('optionsIndexCount', [T.formatCount(size), T.formatCount(max)])
        : msg('optionsIndexEmpty');
      el.downloadIndex.disabled = !size;
      el.clearIndex.disabled = !size;
    });
  }

  /** Hand the list back as a CSV the user can keep. Local, like everything. */
  function download() {
    ask(K.MSG.INDEX_DUMP).then(function (reply) {
      const entries = (reply && reply.entries) || [];
      if (!entries.length) {
        toast(msg('optionsIndexEmpty'));
        return;
      }
      const lines = ['place_id,exported_at'];
      for (let i = 0; i < entries.length; i += 1) {
        let when = '';
        try {
          when = new Date(entries[i].exportedAt).toISOString();
        } catch (_) {
          when = '';
        }
        lines.push(MLE.csv.field(entries[i].placeId) + ',' + MLE.csv.field(when));
      }
      const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], {
        type: 'text/csv;charset=utf-8'
      });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download(
        { url: url, filename: 'maps-leads-already-exported.csv', saveAs: false },
        function () {
          setTimeout(function () {
            URL.revokeObjectURL(url);
          }, 60000);
        }
      );
    });
  }

  function askClear() {
    el.confirmText.textContent = msg('optionsIndexClearConfirm', [T.formatCount(size)]);
    el.confirm.hidden = false;
    el.confirmYes.focus();
  }

  function doClear() {
    ask(K.MSG.INDEX_CLEAR).then(function (reply) {
      el.confirm.hidden = true;
      toast(msg('optionsIndexCleared', [T.formatCount((reply && reply.cleared) || 0)]));
      renderStats();
    });
  }

  el.downloadIndex.addEventListener('click', download);
  el.clearIndex.addEventListener('click', askClear);
  el.confirmNo.addEventListener('click', function () {
    el.confirm.hidden = true;
  });
  el.confirmYes.addEventListener('click', doClear);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !el.confirm.hidden) el.confirm.hidden = true;
  });

  applyStaticText();
  renderStats();
})(typeof self !== 'undefined' ? self : this);
