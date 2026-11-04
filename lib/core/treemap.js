/**
 * Squarified treemap layout (Bruls, Huizing, van Wijk) in plain JavaScript.
 *
 * Pure functions only: this module is unit-tested on the Host and its source
 * is inlined into the prebuilt Client bundle by scripts/build-client.mjs, so
 * Host and panel always draw the same rectangles.
 */

/**
 * @typedef {object} TreemapItem
 * @property {string} key
 * @property {number} value
 *
 * @typedef {object} TreemapRect
 * @property {string} key
 * @property {number} value
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * Layout items into a rectangle. Items with value <= 0 are skipped.
 *
 * @param {TreemapItem[]} items
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @returns {TreemapRect[]}
 */
export function layoutTreemap(items, rect) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (!(rect.w > 0) || !(rect.h > 0)) return [];

  const usable = items
    .filter((item) => Number.isFinite(item.value) && item.value > 0)
    .map((item) => ({ key: item.key, value: item.value }))
    .sort((a, b) => b.value - a.value);

  const total = usable.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return [];

  const area = rect.w * rect.h;
  const nodes = usable.map((item) => ({
    key: item.key,
    value: item.value,
    area: (item.value / total) * area,
  }));

  /** @type {TreemapRect[]} */
  const output = [];
  let row = [];
  let free = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  let index = 0;

  while (index < nodes.length) {
    const node = nodes[index];
    const side = Math.min(free.w, free.h);
    if (row.length === 0 || worstRatio([...row, node], side) <= worstRatio(row, side)) {
      row.push(node);
      index += 1;
      continue;
    }
    free = placeRow(row, free, output);
    row = [];
  }
  if (row.length > 0) placeRow(row, free, output);
  return output;
}

/**
 * Arrange one row along the shorter side of the free rectangle and return the
 * remaining rectangle.
 *
 * @param {{key:string,value:number,area:number}[]} row
 * @param {{x:number,y:number,w:number,h:number}} free
 * @param {TreemapRect[]} out
 */
function placeRow(row, free, out) {
  const sum = row.reduce((total, node) => total + node.area, 0);
  if (sum <= 0) return free;

  if (free.w >= free.h) {
    const width = sum / free.h;
    let y = free.y;
    for (const node of row) {
      const height = node.area / width;
      out.push({ key: node.key, value: node.value, x: free.x, y, w: width, h: height });
      y += height;
    }
    return { x: free.x + width, y: free.y, w: free.w - width, h: free.h };
  }

  const height = sum / free.w;
  let x = free.x;
  for (const node of row) {
    const width = node.area / height;
    out.push({ key: node.key, value: node.value, x, y: free.y, w: width, h: height });
    x += width;
  }
  return { x: free.x, y: free.y + height, w: free.w, h: free.h - height };
}

/**
 * Worst aspect ratio in a prospective row; Infinity for an empty row.
 *
 * @param {{area:number}[]} row
 * @param {number} side
 * @returns {number}
 */
function worstRatio(row, side) {
  if (row.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  let max = 0;
  let min = Number.POSITIVE_INFINITY;
  for (const node of row) {
    sum += node.area;
    if (node.area > max) max = node.area;
    if (node.area < min) min = node.area;
  }
  if (sum <= 0 || side <= 0 || min <= 0) return Number.POSITIVE_INFINITY;
  const side2 = side * side;
  const sum2 = sum * sum;
  return Math.max((side2 * max) / sum2, sum2 / (side2 * min));
}
