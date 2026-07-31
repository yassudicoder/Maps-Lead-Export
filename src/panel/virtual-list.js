/**
 * Fixed-height windowed list.
 *
 * Only the rows within the viewport (plus a small overscan) exist in the DOM,
 * and their nodes are recycled as you scroll, so 2,000 rows cost the same as
 * twenty. Rows are positioned with translate3d rather than `top` to keep the
 * work on the compositor.
 *
 * Fixed height is a deliberate constraint: measuring variable rows would mean a
 * layout pass per row per frame, which is exactly what makes long lists stutter.
 * Row content truncates instead.
 */
(function (root) {
  'use strict';

  const MLE = (root.MLE = root.MLE || {});

  /**
   * @param {{
   *   container: HTMLElement, sizer: HTMLElement, rowHeight: number,
   *   overscan?: number, createRow: function(): HTMLElement,
   *   renderRow: function(HTMLElement, object, number): void
   * }} options
   */
  function VirtualList(options) {
    const container = options.container;
    const sizer = options.sizer;
    let rowHeight = options.rowHeight;
    const overscan = options.overscan || 4;

    let items = [];
    /** @type {Map<number, HTMLElement>} index -> mounted node */
    const mounted = new Map();
    /** @type {HTMLElement[]} detached nodes ready for reuse */
    const pool = [];
    let frame = 0;
    let forceRender = false;

    function schedule() {
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = 0;
        draw();
      });
    }

    function release(index, node) {
      mounted.delete(index);
      node.style.display = 'none';
      node.__index = -1;
      pool.push(node);
    }

    function draw() {
      const total = items.length;
      sizer.style.height = total * rowHeight + 'px';

      const viewport = container.clientHeight;
      const top = container.scrollTop;
      const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
      const end = Math.min(total, Math.ceil((top + viewport) / rowHeight) + overscan);

      mounted.forEach(function (node, index) {
        if (index < start || index >= end) release(index, node);
      });

      for (let i = start; i < end; i += 1) {
        let node = mounted.get(i);
        if (!node) {
          node = pool.pop();
          if (!node) {
            node = options.createRow();
            sizer.appendChild(node);
          }
          node.style.display = '';
          mounted.set(i, node);
          node.__index = -1;
        }
        node.style.transform = 'translate3d(0,' + i * rowHeight + 'px,0)';
        // Re-render only when this node is showing a different item than
        // before; plain scrolling then costs one transform per row.
        if (forceRender || node.__index !== i) {
          options.renderRow(node, items[i], i);
          node.__index = i;
        }
      }

      forceRender = false;
    }

    container.addEventListener('scroll', schedule, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(function () {
            schedule();
          })
        : null;
    if (resizeObserver) resizeObserver.observe(container);

    return {
      /** Replace the backing data. Cheap: nothing renders until the next frame. */
      setItems: function (next) {
        items = next || [];
        forceRender = true;
        schedule();
      },
      /** Re-render mounted rows in place, e.g. after rows were updated. */
      refresh: function () {
        forceRender = true;
        schedule();
      },
      /**
       * Change the height every row is drawn at.
       *
       * Rows stay uniform, which is what keeps windowing to arithmetic instead
       * of measurement. The list switches height once, when the session first
       * gains contact details worth a third line.
       */
      setRowHeight: function (next) {
        if (!next || next === rowHeight) return;
        rowHeight = next;
        container.style.setProperty('--row-height', next + 'px');
        forceRender = true;
        schedule();
      },
      count: function () {
        return items.length;
      },
      destroy: function () {
        container.removeEventListener('scroll', schedule);
        if (resizeObserver) resizeObserver.disconnect();
        if (frame) cancelAnimationFrame(frame);
        mounted.forEach(function (node) {
          node.remove();
        });
        mounted.clear();
        pool.length = 0;
      }
    };
  }

  MLE.VirtualList = VirtualList;
})(typeof self !== 'undefined' ? self : this);
