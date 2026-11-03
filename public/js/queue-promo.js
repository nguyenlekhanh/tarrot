// Decides whether the empty-queue promotion owns the movement row. Kept pure
// and dependency-free so the stage and Node tests share one rule.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QueuePromo = api;
})(typeof window !== 'undefined' ? window : null, function () {
  function waitingCount(queue) {
    const count = Number(queue && queue.count);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }

  // True only when nobody is in line: one waiting viewer restores the live row.
  function hasWaiting(queue) {
    return waitingCount(queue) > 0;
  }

  function promoVisible(queue) {
    return !hasWaiting(queue);
  }

  return { waitingCount, hasWaiting, promoVisible };
});
