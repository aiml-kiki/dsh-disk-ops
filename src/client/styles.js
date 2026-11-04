export const STYLES = `
.dsh-disk-root {
  --dsh-disk-line: rgba(127,127,127,.16);
  --dsh-disk-soft: rgba(127,127,127,.07);
  --dsh-disk-accent: #4d7ea8;
  --dsh-disk-accent-soft: rgba(77,126,168,.14);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 6px 2px 22px;
  color: inherit;
  font-size: 13px;
  line-height: 1.5;
}
.dsh-disk-header { display: flex; align-items: flex-start; gap: 12px; }
.dsh-disk-headline { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; min-width: 0; }
.dsh-disk-title { font-size: 17px; font-weight: 650; letter-spacing: .01em; }
.dsh-disk-meta { font-size: 12px; opacity: .62; font-variant-numeric: tabular-nums; }
.dsh-disk-head-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.dsh-disk-pulse { font-size: 11px; opacity: .6; }
.dsh-disk-ghost {
  border: 1px solid var(--dsh-disk-line);
  background: transparent;
  color: inherit;
  border-radius: 8px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.dsh-disk-ghost:hover:not(:disabled) { background: var(--dsh-disk-soft); border-color: rgba(127,127,127,.3); }
.dsh-disk-ghost:disabled { opacity: .45; cursor: default; }
.dsh-disk-bar {
  height: 7px;
  border-radius: 999px;
  background: var(--dsh-disk-soft);
  overflow: hidden;
}
.dsh-disk-bar-used {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #4d7ea8, #8a6f9e);
  transition: width .35s ease;
}
.dsh-disk-main {
  display: grid;
  grid-template-columns: minmax(0, 2.15fr) minmax(268px, 1fr);
  gap: 20px;
  align-items: stretch;
}
@media (max-width: 780px) {
  .dsh-disk-main { grid-template-columns: minmax(0, 1fr); }
}
.dsh-disk-left { min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.dsh-disk-toolbar { display: flex; align-items: center; gap: 12px; min-width: 0; margin: 0 2px; }
.dsh-disk-crumbs { display: flex; align-items: center; gap: 1px; flex-wrap: wrap; min-width: 0; }
.dsh-disk-back {
  width: 22px; height: 22px;
  border: 1px solid var(--dsh-disk-line);
  background: transparent; color: inherit;
  border-radius: 6px; cursor: pointer; font-size: 12px; line-height: 1;
  margin-right: 6px;
}
.dsh-disk-back:hover:not(:disabled) { background: var(--dsh-disk-soft); }
.dsh-disk-back:disabled { opacity: .3; cursor: default; }
.dsh-disk-crumb {
  border: none; background: transparent; color: inherit; cursor: pointer;
  padding: 3px 5px; border-radius: 5px; font-size: 12px; opacity: .62;
  max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-disk-crumb:hover { background: var(--dsh-disk-soft); opacity: .95; }
.dsh-disk-crumb-current { opacity: 1; font-weight: 600; }
.dsh-disk-sep { opacity: .3; font-size: 11px; }
.dsh-disk-status { margin-left: auto; font-size: 10.5px; opacity: .45; white-space: nowrap; }
.dsh-disk-map {
  width: 100%; height: auto; aspect-ratio: 1000 / 470;
  border-radius: 12px; background: var(--dsh-disk-soft);
  display: block; overflow: hidden;
}
.dsh-disk-cell { cursor: pointer; }
.dsh-disk-cell rect {
  stroke: rgba(255,255,255,.14);
  stroke-width: 1;
  transition: opacity .12s ease;
}
.dsh-disk-cell:hover rect { opacity: .82; stroke: rgba(255,255,255,.55); stroke-width: 2; }
.dsh-disk-cell-name { fill: rgba(255,255,255,.96); font-size: 13px; font-weight: 600; pointer-events: none; }
.dsh-disk-cell-size { fill: rgba(255,255,255,.72); font-size: 11px; pointer-events: none; font-variant-numeric: tabular-nums; }
.dsh-disk-right {
  overflow: hidden;
  border: 1px solid var(--dsh-disk-line);
  border-radius: 12px;
  padding: 12px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 280px;
}
.dsh-disk-right-empty { justify-content: flex-start; }
.dsh-disk-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.dsh-disk-panel-title { font-size: 13px; font-weight: 650; }
.dsh-disk-panel-sub { font-size: 10.5px; opacity: .55; font-variant-numeric: tabular-nums; }
.dsh-disk-filters { display: flex; gap: 6px; }
.dsh-disk-chip {
  border: 1px solid var(--dsh-disk-line);
  background: transparent; color: inherit;
  border-radius: 999px; padding: 2px 9px; font-size: 11px; cursor: pointer;
  opacity: .7;
  transition: all .12s ease;
}
.dsh-disk-chip:hover { opacity: 1; background: var(--dsh-disk-soft); }
.dsh-disk-chip-on { background: var(--dsh-disk-accent-soft); border-color: rgba(77,126,168,.45); opacity: 1; font-weight: 600; }
.dsh-disk-suggestions {
  display: flex; flex-direction: column; gap: 1px;
  flex: 1 1 auto; min-height: 0; overflow: auto; margin: 0 -4px; padding: 0 4px;
}
.dsh-disk-suggestion {
  display: grid;
  grid-template-columns: 16px 8px minmax(0, 1fr) auto auto 14px;
  grid-template-areas: 'check dot cat tag size locate' '. . path path path path';
  gap: 2px 8px;
  padding: 6px 5px;
  border-radius: 7px;
  min-width: 0;
  cursor: pointer;
  transition: background .12s ease;
}
.dsh-disk-suggestion:hover { background: var(--dsh-disk-soft); }
.dsh-disk-suggestion-on { background: var(--dsh-disk-accent-soft); }
.dsh-disk-suggestion-locked { cursor: default; opacity: .7; }
.dsh-disk-check {
  grid-area: check;
  width: 15px; height: 15px; margin-top: 2px;
  border: 1px solid rgba(127,127,127,.4);
  border-radius: 4px;
  font-size: 10px; line-height: 13px; text-align: center;
  color: #fff;
  transition: all .12s ease;
}
.dsh-disk-check-on { background: var(--dsh-disk-accent); border-color: var(--dsh-disk-accent); }
.dsh-disk-suggestion-locked .dsh-disk-check { opacity: .25; }
.dsh-disk-dot { grid-area: dot; width: 7px; height: 7px; border-radius: 999px; margin-top: 5px; }
.dsh-disk-sug-cat { grid-area: cat; font-size: 12px; font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-disk-sug-size { grid-area: size; font-size: 12px; font-variant-numeric: tabular-nums; opacity: .9; }
.dsh-disk-sug-path {
  grid-area: path; font-size: 10px; opacity: .45;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-disk-link {
  border: none; background: transparent; color: inherit;
  padding: 0; font-size: 10.5px; opacity: .55; cursor: pointer; text-decoration: underline;
  text-underline-offset: 2px;
}
.dsh-disk-link:hover { opacity: .95; }
.dsh-disk-actionbar {
  display: flex; align-items: center; gap: 10px;
  padding: 2px 0 9px;
  border-bottom: 1px solid var(--dsh-disk-line);
}
.dsh-disk-selection { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dsh-disk-selection > span { font-size: 11px; font-variant-numeric: tabular-nums; }
.dsh-disk-dim { opacity: .5; }
.dsh-disk-primary {
  margin-left: auto;
  border: none; background: var(--dsh-disk-accent); color: #fff;
  border-radius: 8px; padding: 7px 16px;
  font-size: 12px; font-weight: 600; cursor: pointer;
  transition: background .15s ease, opacity .15s ease;
}
.dsh-disk-primary:hover:not(:disabled) { background: #5a8cb8; }
.dsh-disk-primary:disabled { opacity: .35; cursor: default; }
.dsh-disk-confirm {
  border: 1px solid rgba(77,126,168,.4);
  background: var(--dsh-disk-accent-soft);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 4px;
}
.dsh-disk-confirm-title { font-size: 12px; font-weight: 650; }
.dsh-disk-confirm-sub { font-size: 10px; opacity: .55; }
.dsh-disk-confirm-actions { display: flex; gap: 8px; margin-top: 4px; }
.dsh-disk-confirm-actions .dsh-disk-primary { margin-left: 0; flex: 1; }
.dsh-disk-notice {
  font-size: 11px; line-height: 1.45;
  padding: 7px 9px; border-radius: 8px;
  background: var(--dsh-disk-soft); opacity: .85;
}
.dsh-disk-bottom {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dsh-disk-line);
  border-radius: 12px;
  padding: 12px 14px;
}
.dsh-disk-bottom .dsh-disk-panel-head { margin-bottom: 6px; }
.dsh-disk-big-list { display: flex; flex-direction: column; }
.dsh-disk-big-row {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr) auto auto auto;
  gap: 10px; align-items: baseline;
  padding: 4px 0;
  border-bottom: 1px dashed var(--dsh-disk-line);
  font-size: 12px;
}
.dsh-disk-big-row:last-child { border-bottom: none; }
.dsh-disk-big-size { text-align: right; font-variant-numeric: tabular-nums; opacity: .85; }
.dsh-disk-big-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px; opacity: .58;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-disk-empty { font-size: 12px; opacity: .5; padding: 10px 0; }
.dsh-disk-empty-map { text-align: center; }
.dsh-disk-error {
  border: 1px solid rgba(194,90,90,.45);
  background: rgba(194,90,90,.1);
  border-radius: 10px; padding: 9px 12px; font-size: 12px;
}
.dsh-disk-foot { font-size: 10px; opacity: .38; }
.dsh-disk-tip {
  position: fixed;
  z-index: 9999;
  max-width: 320px;
  padding: 9px 11px;
  border-radius: 10px;
  background: rgba(24,26,30,.94);
  color: #f4f5f7;
  box-shadow: 0 8px 28px rgba(0,0,0,.28);
  pointer-events: none;
  display: flex; flex-direction: column; gap: 3px;
}
.dsh-disk-tip-name { font-size: 12px; font-weight: 650; }
.dsh-disk-tip-meta { font-size: 10.5px; opacity: .72; font-variant-numeric: tabular-nums; }
.dsh-disk-tip-path { font-size: 9.5px; opacity: .5; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.dsh-disk-tip-hint { font-size: 9.5px; opacity: .45; margin-top: 2px; }
.dsh-disk-map-wrap { position: relative; }
.dsh-disk-map-pending { pointer-events: none; }
.dsh-disk-map-pending .dsh-disk-map { opacity: .32; filter: saturate(.6); transition: opacity .15s ease; }
.dsh-disk-map-veil {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; letter-spacing: .04em; opacity: .7;
  background: radial-gradient(circle at center, rgba(127,127,127,.06), transparent 60%);
  border-radius: 12px;
}
.dsh-disk-map-skeleton {
  width: 100%; aspect-ratio: 1000 / 470; border-radius: 12px;
  background: linear-gradient(100deg, rgba(127,127,127,.06) 30%, rgba(127,127,127,.13) 50%, rgba(127,127,127,.06) 70%);
  background-size: 240% 100%;
  animation: dsh-disk-shimmer 1.1s ease-in-out infinite;
}
@keyframes dsh-disk-shimmer { from { background-position: 140% 0; } to { background-position: -40% 0; } }
.dsh-disk-suggestions {
  mask-image: linear-gradient(to bottom, #000 calc(100% - 12px), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 12px), transparent 100%);
  padding-bottom: 8px;
}

.dsh-disk-big-row .dsh-disk-link { opacity: 0; transition: opacity .12s ease; }
.dsh-disk-big-row:hover .dsh-disk-link, .dsh-disk-big-row:focus-within .dsh-disk-link { opacity: .6; }
.dsh-disk-root button:focus-visible,
.dsh-disk-root [role='button']:focus-visible {
  outline: 2px solid rgba(77,126,168,.55);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .dsh-disk-bar-used, .dsh-disk-cell rect, .dsh-disk-suggestion, .dsh-disk-check { transition: none; }
  .dsh-disk-map-skeleton { animation: none; }
}

.dsh-disk-restricted {
  aspect-ratio: 1000 / 470;
  min-height: 200px;
  border: 1px dashed rgba(127,127,127,.3);
  border-radius: 12px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; text-align: center; padding: 24px;
  background: var(--dsh-disk-soft);
}
.dsh-disk-restricted-title { font-size: 13px; font-weight: 600; opacity: .8; }
.dsh-disk-restricted-sub { font-size: 11px; opacity: .5; max-width: 420px; line-height: 1.6; }

.dsh-disk-scope { display: flex; gap: 2px; background: var(--dsh-disk-soft); border-radius: 8px; padding: 2px; }
.dsh-disk-scope-btn {
  flex: 1; border: none; background: transparent; color: inherit;
  font-size: 10.5px; padding: 3px 6px; border-radius: 6px; cursor: pointer; opacity: .6;
  transition: opacity .12s ease, background .12s ease;
}
.dsh-disk-scope-btn:hover { opacity: .9; }
.dsh-disk-scope-on { background: var(--dsh-disk-accent-soft); opacity: 1; font-weight: 600; }
.dsh-disk-search {
  width: 100%; border: 1px solid var(--dsh-disk-line); background: transparent; color: inherit;
  border-radius: 7px; padding: 4px 8px; font-size: 11px; outline: none;
}
.dsh-disk-search:focus { border-color: rgba(77,126,168,.55); }
.dsh-disk-search::placeholder { opacity: .4; }
.dsh-disk-cell-hot rect { stroke: #fff; stroke-width: 2.5; opacity: 1; }
.dsh-disk-locate {
  grid-area: locate; border: none; background: transparent; color: inherit;
  font-size: 11px; cursor: pointer; opacity: 0; padding: 0; line-height: 1;
  transition: opacity .12s ease;
}
.dsh-disk-suggestion:hover .dsh-disk-locate { opacity: .45; }
.dsh-disk-locate:hover { opacity: 1; }
.dsh-disk-tip-rule { font-size: 10px; color: #8fd6a8; }
.dsh-disk-tag {
  font-size: 9.5px; line-height: 1; padding: 3px 5px; border-radius: 5px;
  background: var(--dsh-disk-soft); opacity: .8; white-space: nowrap;
}
.dsh-disk-tag-safe { color: #3f9b6d; background: rgba(63,155,109,.1); }
.dsh-disk-tag-probably { color: #b47a2a; background: rgba(180,122,42,.1); }
.dsh-disk-tag-risky { color: #b35a5a; background: rgba(179,90,90,.1); }
.dsh-disk-cell-del { opacity: 0; cursor: pointer; transition: opacity .12s ease; }
.dsh-disk-cell:hover .dsh-disk-cell-del { opacity: .9; }
.dsh-disk-cell-del circle { fill: rgba(20,24,30,.42); }
.dsh-disk-del-x { fill: #fff; font-size: 14px; font-weight: 600; pointer-events: none; }
.dsh-disk-danger { color: #c25a5a; opacity: .75; }
.dsh-disk-danger:hover { opacity: 1; }
.dsh-disk-confirm-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px; opacity: .55; word-break: break-all;
}
.dsh-disk-bottom-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.dsh-disk-bottom-head .dsh-disk-scope { flex: 0 0 128px; }
.dsh-disk-empty .dsh-disk-link { margin-left: 6px; }

.dsh-disk-selection-warn { color: #c9973f; }

`;
