/**
 * Client half of dsh-disk-ops: the visualization panel.
 *
 * First-principles layout: one screen answers three questions —
 *   1. 空间去哪了：容量条 + 可下钻的 treemap（面积=占用，悬浮给路径/占比）
 *   2. 能清什么：按安全等级分组的建议，勾选即选
 *   3. 清得安全吗：内联计划 + 二次确认，默认移入废纸篓
 *
 * Plain React.createElement: the bundle only requires `react` from the client
 * module table, and reuses the Host-tested pure functions (formatBytes,
 * layoutTreemap) through the shared inline block.
 */

var inject = ['slots'];

var SAFETY_COLOR = {
  safe: 'var(--dsh-disk-safe, #3f9b6d)',
  probably: 'var(--dsh-disk-probably, #c9973f)',
  risky: 'var(--dsh-disk-risky, #c25a5a)',
  irreversible: 'var(--dsh-disk-risky, #c25a5a)',
};

var CELL_COLORS = [
  '#4d7ea8', '#5b8c6e', '#8a6f9e', '#a8763e', '#5f7f8f',
  '#7a8a52', '#9a5f6f', '#4f6f8f', '#6d7f5a', '#8f6a4f',
];

function ensureStyles() {
  var id = 'dsh-disk-ops-style';
  if (typeof document === 'undefined') return function () {};
  if (document.getElementById(id) !== null) return function () {};
  var element = document.createElement('style');
  element.id = id;
  element.textContent = STYLES;
  document.head.appendChild(element);
  return function () {
    element.remove();
  };
}

function shortName(name, max) {
  if (typeof name !== 'string') return '';
  if (name.length <= max) return name;
  return name.slice(0, Math.max(1, max - 1)) + '…';
}

function baseName(path) {
  var parts = String(path || '').split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : String(path || '');
}

function suggestionTitle(item) {
  if (item.category === '应用缓存' && item.path) return baseName(item.path);
  return item.category;
}

function truncatePath(path, max) {
  if (typeof path !== 'string') return '';
  if (path.length <= max) return path;
  var head = Math.max(8, Math.floor(max / 2));
  var tail = Math.max(8, max - head - 1);
  return path.slice(0, head) + '…' + path.slice(-tail);
}

function jget(url) {
  return fetch(url, { headers: { accept: 'application/json' } }).then(function (response) {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  });
}

function jpost(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (response) {
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  });
}

function pct(part, whole) {
  if (!whole || whole <= 0) return '';
  return Math.max(0.1, (part / whole) * 100).toFixed(1) + '%';
}

function DiskPanel() {
  var stackState = React.useState([]);
  var stack = stackState[0];
  var setStack = stackState[1];
  var current = stack.length === 0 ? null : stack[stack.length - 1].path;

  var reportState = React.useState(null);
  var report = reportState[0];
  var setReport = reportState[1];
  var refreshingState = React.useState(false);
  var refreshing = refreshingState[0];
  var setRefreshing = refreshingState[1];
  var errorState = React.useState('');
  var error = errorState[0];
  var setError = errorState[1];

  var suggestionsState = React.useState(null);
  var suggestions = suggestionsState[0];
  var setSuggestions = suggestionsState[1];
  var bigState = React.useState(null);
  var big = bigState[0];
  var setBig = bigState[1];

  var selectedState = React.useState({});
  var selected = selectedState[0];
  var setSelected = selectedState[1];
  var planState = React.useState(null);
  var plan = planState[0];
  var setPlan = planState[1];
  var noticeState = React.useState('');
  var notice = noticeState[0];
  var setNotice = noticeState[1];
  var busyState = React.useState('');
  var busy = busyState[0];
  var setBusy = busyState[1];
  var pendingState = React.useState(true);
  var pending = pendingState[0];
  var setPending = pendingState[1];
  var filterState = React.useState('all');
  var filter = filterState[0];
  var setFilter = filterState[1];
  var kindState = React.useState('all');
  var kindFilter = kindState[0];
  var setKindFilter = kindState[1];
  var scopeState = React.useState('all');
  var sugScope = scopeState[0];
  var setSugScope = scopeState[1];
  var queryState = React.useState('');
  var query = queryState[0];
  var setQuery = queryState[1];
  var bigScopeState = React.useState('home');
  var bigScope = bigScopeState[0];
  var setBigScope = bigScopeState[1];
  var homePathState = React.useState('');
  var homePath = homePathState[0];
  var setHomePath = homePathState[1];
  var hoverState = React.useState('');
  var hoverKey = hoverState[0];
  var setHoverKey = hoverState[1];
  var highlightState = React.useState('');
  var highlight = highlightState[0];
  var setHighlight = highlightState[1];
  var tipState = React.useState(null);
  var tip = tipState[0];
  var setTip = tipState[1];

  var clickTimer = React.useRef(null);
  var searchRef = React.useRef(null);
  var queryRef = React.useRef('');
  queryRef.current = query;

  React.useEffect(function () {
    function onKey(event) {
      if (event.key === 'Escape') {
        if (queryRef.current !== '') {
          setQuery('');
          event.preventDefault();
          return;
        }
        setStack(function (prev) { return prev.length === 0 ? prev : prev.slice(0, prev.length - 1); });
        return;
      }
      if (event.key === '/' && searchRef.current !== null) {
        var tag = event.target && event.target.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          event.preventDefault();
          searchRef.current.focus();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  }, []);

  // Report: render whichever cache exists immediately, then refresh in the
  // background when it is stale. No blank screen, no waiting on `du`.
  React.useEffect(function () {
    var alive = true;
    setPending(true);
    setError('');
    setTip(null);
    var base = current === null ? '' : 'path=' + encodeURIComponent(current) + '&';
    jget('/disk-ops/report?' + base + 't=' + Date.now())
      .then(function (data) {
        if (!alive) return;
        setReport(data);
        setPending(false);
        if (data.stale === true) {
          setRefreshing(true);
          jget('/disk-ops/report?' + base + 'refresh=1&t=' + Date.now())
            .then(function (fresh) { if (alive) setReport(fresh); })
            .catch(function () { /* keep the cached view */ })
            .finally(function () { if (alive) setRefreshing(false); });
        }
      })
      .catch(function (problem) {
        if (!alive) return;
        setError(String(problem.message || problem));
        setPending(false);
      });
    return function () { alive = false; };
  }, [current]);

  React.useEffect(function () {
    setSugScope('here');
    setBigScope(current === null ? 'home' : 'here');
    setQuery('');
    setHoverKey('');
  }, [current]);

  React.useEffect(function () {
    if (report !== null && current === null && typeof report.path === 'string') setHomePath(report.path);
  }, [report, current]);

  React.useEffect(function () {
    var alive = true;
    var params = '?t=' + Date.now();
    if (bigScope === 'here' && current !== null) params += '&path=' + encodeURIComponent(current);
    jget('/disk-ops/big' + params)
      .then(function (data) { if (alive) setBig(data); })
      .catch(function () {});
    return function () { alive = false; };
  }, [current, bigScope]);

  React.useEffect(function () {
    if (highlight === '') return undefined;
    var timer = setTimeout(function () { setHighlight(''); }, 4000);
    return function () { clearTimeout(timer); };
  }, [highlight]);

  React.useEffect(function () {
    var alive = true;
    jget('/disk-ops/suggestions?t=' + Date.now())
      .then(function (data) {
        if (!alive) return;
        setSuggestions(data);
        if (data.stale === true) {
          jget('/disk-ops/suggestions?refresh=1&t=' + Date.now())
            .then(function (fresh) { if (alive) setSuggestions(fresh); })
            .catch(function () {});
        }
      })
      .catch(function () {});
    return function () { alive = false; };
  }, []);

  function refreshAll() {
    setRefreshing(true);
    setPlan(null);
    setNotice('');
    var base = current === null ? '' : 'path=' + encodeURIComponent(current) + '&';
    jget('/disk-ops/report?' + base + 'refresh=1&t=' + Date.now())
      .then(function (data) { setReport(data); })
      .catch(function (problem) { setError(String(problem.message || problem)); })
      .finally(function () { setRefreshing(false); });
    jget('/disk-ops/suggestions?refresh=1&t=' + Date.now())
      .then(function (data) { setSuggestions(data); })
      .catch(function () {});
    var bigParams = '?t=' + Date.now() + (bigScope === 'here' && current !== null ? '&path=' + encodeURIComponent(current) : '');
    jget('/disk-ops/big' + bigParams)
      .then(function (data) { setBig(data); })
      .catch(function () {});
  }

  function enter(entry) {
    if (!entry || entry.is_dir !== true) return;
    if (entry.restricted === true) {
      setNotice('受 macOS 隐私保护，不能展开（体积仍可查看）');
      return;
    }
    setStack(stack.concat([{ name: entry.name, path: entry.path }]));
  }

  function back() {
    if (stack.length === 0) return;
    setStack(stack.slice(0, stack.length - 1));
  }

  function goTo(index) {
    setStack(index < 0 ? [] : stack.slice(0, index + 1));
  }

  function reveal(path) {
    jpost('/disk-ops/reveal', { path: path }).catch(function () {});
  }

  function locate(path) {
    if (!homePath || path.indexOf(homePath + '/') !== 0) {
      setNotice('只能定位家目录内的项目');
      return;
    }
    var parts = path.slice(homePath.length + 1).split('/');
    var acc = homePath;
    var next = [];
    for (var index = 0; index < parts.length - 1; index += 1) {
      acc = acc + '/' + parts[index];
      next.push({ name: parts[index], path: acc });
    }
    setStack(next);
    setHighlight(path);
  }

  function onCellClick(entry) {
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(function () {
      clickTimer.current = null;
      enter(entry);
    }, 220);
  }

  function onCellDouble(entry) {
    if (clickTimer.current !== null) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    reveal(entry.path);
  }

  function toggle(item) {
    var next = {};
    Object.keys(selected).forEach(function (key) { next[key] = selected[key]; });
    if (next[item.path]) delete next[item.path];
    else next[item.path] = {
      path: item.path,
      size: typeof item.size === 'number' ? item.size : 0,
      manual: item.kind === 'entry'
        ? item.manual !== false
        : !(item.action === 'trash' && item.deletable !== false && item.size !== null),
    };
    setSelected(next);
    setPlan(null);
  }

  function selectedItems() {
    return Object.keys(selected).map(function (key) { return selected[key]; });
  }

  function selectSafe() {
    var next = {};
    scopeItems.forEach(function (item) {
      var eligible = item.kind === 'entry'
        ? item.safety === 'safe' && item.manual !== true && typeof item.size === 'number'
        : item.safety === 'safe' && item.action === 'trash' && item.deletable !== false && item.size !== null;
      if (!eligible) return;
      next[item.path] = { path: item.path, size: item.size, manual: item.kind === 'entry' ? item.manual === true : false };
    });
    setSelected(next);
    setPlan(null);
  }

  function clearSelection() {
    setSelected({});
    setPlan(null);
  }

  function startPlan() {
    var items = selectedItems();
    if (items.length === 0) return;
    setBusy('plan');
    setNotice('');
    var manual = items.some(function (item) { return item.manual === true; });
    jpost('/disk-ops/plan', { items: items, manual: manual })
      .then(function (data) {
        if (data && data.ok) {
          setPlan(data.plan);
          setNotice('');
        } else {
          setNotice('生成计划失败：' + ((data && data.error) || '未知错误'));
        }
      })
      .catch(function (problem) { setNotice('生成计划失败：' + problem); })
      .finally(function () { setBusy(''); });
  }

  function manualPlan(entry) {
    if (!entry || typeof entry.path !== 'string' || entry.restricted === true) return;
    setBusy('plan');
    setNotice('');
    jpost('/disk-ops/plan', {
      manual: true,
      items: [{ path: entry.path, size: typeof entry.size === 'number' ? entry.size : undefined }],
    })
      .then(function (data) {
        var next = data && data.plan;
        if (data && data.ok && next && next.items.length > 0) {
          setPlan(next);
        } else {
          var reason = next && next.skipped && next.skipped[0] ? next.skipped[0].reason : '路径受保护或不可读';
          setNotice('无法删除：' + ((data && (data.error || data.reason)) || reason));
        }
      })
      .catch(function (problem) { setNotice('无法删除：' + problem); })
      .finally(function () { setBusy(''); });
  }

  function confirmPlan() {
    if (plan === null) return;
    setBusy('clean');
    jpost('/disk-ops/clean', {
      plan_id: plan.plan_id,
      token: plan.token,
      ids: plan.items.map(function (item) { return item.id; }),
    })
      .then(function (data) {
        if (data && data.ok) {
          var result = data.result || { trashed: [], total: 0, skipped: [] };
          setNotice('已移入废纸篓 ' + result.trashed.length + ' 项 · ' + formatBytes(result.total) +
            (result.skipped.length > 0 ? '，跳过 ' + result.skipped.length + ' 项（内容已变化）' : ''));
          setSelected({});
          setPlan(null);
          setReport(null);
          refreshAll();
        } else {
          setNotice('清理失败：' + ((data && (data.error || data.reason)) || '未知错误'));
        }
      })
      .catch(function (problem) { setNotice('清理失败：' + problem); })
      .finally(function () { setBusy(''); });
  }

  var disk = report && report.disk ? report.disk : null;
  var usedPercent = disk && disk.total > 0 ? (disk.used / disk.total) * 100 : 0;
  var entries = report && Array.isArray(report.entries) ? report.entries : [];
  var sized = entries.filter(function (entry) { return typeof entry.size === 'number' && entry.size > 0; });
  var total = report && typeof report.total === 'number' ? report.total : 0;

  var header = h('div', { className: 'dsh-disk-header' },
    h('div', { className: 'dsh-disk-headline' },
      h('span', { className: 'dsh-disk-title' }, '磁盘空间'),
      disk !== null ? h('span', { className: 'dsh-disk-meta' },
        formatBytes(disk.used) + ' 已用 · ' + formatBytes(disk.free) + ' 可用 · 共 ' + formatBytes(disk.total)) : null,
    ),
    h('div', { className: 'dsh-disk-head-actions' },
      refreshing ? h('span', { className: 'dsh-disk-pulse' }, '更新中…') : null,
      h('button', { className: 'dsh-disk-ghost', type: 'button', onClick: refreshAll, disabled: refreshing }, '刷新'),
    ),
  );

  var bar = h('div', { className: 'dsh-disk-bar', title: '已用 ' + pct(disk ? disk.used : 0, disk ? disk.total : 0) },
    h('div', { className: 'dsh-disk-bar-used', style: { width: Math.min(100, usedPercent) + '%' } }),
  );

  var reclaim = suggestions && typeof suggestions.reclaimable === 'number' ? suggestions.reclaimable : 0;
  var safeSum = 0;
  var cautionSum = 0;
  var suggestionList = suggestions && Array.isArray(suggestions.suggestions) ? suggestions.suggestions : [];
  suggestionList.forEach(function (item) {
    if (item.action !== 'trash' || item.deletable === false || item.size === null) return;
    if (item.safety === 'safe') safeSum += item.size;
    else cautionSum += item.size;
  });

  var ruleByPath = {};
  suggestionList.forEach(function (item) { if (item.size !== null) ruleByPath[item.path] = item; });
  var safetyLabel = { safe: '安全', probably: '谨慎', risky: '只报告', irreversible: '不可逆' };

  var levelItems = entries
    .filter(function (entry) { return typeof entry.size === 'number' && entry.size > 0 && entry.restricted !== true; })
    .map(function (entry) {
      var rule = ruleByPath[entry.path];
      return {
        kind: 'entry',
        path: entry.path,
        name: entry.name,
        size: entry.size,
        is_dir: entry.is_dir,
        safety: rule ? rule.safety : '',
        category: rule ? rule.category : '',
        manual: !(rule !== undefined && rule.action === 'trash' && rule.deletable !== false),
      };
    });

  var scopeItems = sugScope === 'here' ? levelItems : suggestionList;
  var queryLower = query.trim().toLowerCase();
  var visible = scopeItems.filter(function (item) {
    if (sugScope === 'here') {
      if (kindFilter === 'dir' && item.is_dir !== true) return false;
      if (kindFilter === 'file' && item.is_dir === true) return false;
    } else if (filter !== 'all' && item.safety !== filter) {
      return false;
    }
    if (queryLower === '') return true;
    return ((item.category || '') + ' ' + item.path + ' ' + (item.name || '')).toLowerCase().indexOf(queryLower) !== -1;
  });

  var dirCount = levelItems.filter(function (item) { return item.is_dir === true; }).length;
  var fileCount = levelItems.length - dirCount;
  var hereReclaim = levelItems.reduce(function (sum, item) {
    return sum + (item.safety !== '' && item.manual !== true ? item.size : 0);
  }, 0);
  var activeFilter = sugScope === 'here' ? kindFilter : filter;

  // Which cell on the current level owns this suggestion? Hovering a row
  // lights up that block, so the list and the map read as one surface.
  function ownerCellPath(itemPath) {
    var base = current === null ? homePath : current;
    if (!base || itemPath.indexOf(base + '/') !== 0) return '';
    var rest = itemPath.slice(base.length + 1).split('/')[0];
    return base + '/' + rest;
  }

  function reclaimUnder(target) {
    var count = 0;
    var bytes = 0;
    suggestionList.forEach(function (item) {
      if (item.action !== 'trash' || item.deletable === false || item.size === null) return;
      if (item.path.indexOf(target + '/') !== 0) return;
      count += 1;
      bytes += item.size;
    });
    return { count: count, bytes: bytes };
  }

  var hoverOwner = hoverKey === '' ? '' : ownerCellPath(hoverKey);

  var crumbs = [h('button', {
    key: 'home', className: 'dsh-disk-crumb' + (stack.length === 0 ? ' dsh-disk-crumb-current' : ''),
    onClick: function () { goTo(-1); }, type: 'button',
  }, '家目录')];
  stack.forEach(function (item, index) {
    crumbs.push(h('span', { key: 'sep' + index, className: 'dsh-disk-sep' }, '/'));
    crumbs.push(h('button', {
      key: 'crumb' + index,
      className: 'dsh-disk-crumb' + (index === stack.length - 1 ? ' dsh-disk-crumb-current' : ''),
      onClick: function () { goTo(index); },
      type: 'button',
    }, item.name));
  });

  var treemap = null;
  if (report !== null) {
    var rects = layoutTreemap(sized.map(function (entry) { return { key: entry.path, value: entry.size }; }),
      { x: 0, y: 0, w: 1000, h: 470 });
    var byPath = {};
    entries.forEach(function (entry) { byPath[entry.path] = entry; });
    treemap = h('svg', {
      className: 'dsh-disk-map',
      viewBox: '0 0 1000 470',
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': '磁盘占用树图',
    }, rects.map(function (rect, index) {
      var entry = byPath[rect.key] || { name: rect.key, is_dir: true, size: rect.value, path: rect.key };
      var share = total > 0 ? (entry.size / total) * 100 : 0;
      return h('g', {
        key: rect.key,
        className: 'dsh-disk-cell' + ((entry.path === hoverOwner || entry.path === highlight) ? ' dsh-disk-cell-hot' : ''),
        onClick: function () { onCellClick(entry); },
        onDoubleClick: function () { onCellDouble(entry); },
        onMouseMove: function (event) { setTip({ x: event.clientX, y: event.clientY, entry: entry, share: share }); },
        onMouseLeave: function () { setTip(null); },
      },
        h('rect', {
          x: rect.x, y: rect.y, width: rect.w, height: rect.h,
          rx: Math.min(7, rect.w / 6, rect.h / 6),
          fill: CELL_COLORS[index % CELL_COLORS.length],
        }),
        rect.w > 70 && rect.h > 36
          ? h('text', { x: rect.x + 9, y: rect.y + 19, className: 'dsh-disk-cell-name' }, shortName(entry.name, Math.floor(rect.w / 8)))
          : null,
        rect.w > 70 && rect.h > 54
          ? h('text', { x: rect.x + 9, y: rect.y + 36, className: 'dsh-disk-cell-size' }, formatBytes(entry.size))
          : null,
        !entry.restricted && entry.size > 0 && rect.w > 120 && rect.h > 70
          ? h('g', {
              className: 'dsh-disk-cell-del',
              onClick: function (event) { event.stopPropagation(); manualPlan(entry); },
            },
              h('circle', { cx: rect.x + rect.w - 18, cy: rect.y + 18, r: 11 }),
              h('text', { x: rect.x + rect.w - 18, y: rect.y + 23, 'text-anchor': 'middle', className: 'dsh-disk-del-x' }, '×'),
            )
          : null,
      );
    }));
  }

  var status = pending
    ? '扫描中…'
    : (report === null ? '' : (report.scan_status === 'restricted'
        ? '受 macOS 隐私保护，未展开'
        : (report.scan_status === 'complete' ? '已完整扫描' : '部分结果（权限或预算限制）')) +
      (report.cached === true ? ' · 缓存' : '') +
      (report.generated_at ? ' · ' + new Date(report.generated_at).toLocaleTimeString() : '') +
      (total > 0 ? ' · 本层 ' + formatBytes(total) : ''));

  var toolbar = h('div', { className: 'dsh-disk-toolbar' },
    h('div', { className: 'dsh-disk-crumbs' },
      h('button', { className: 'dsh-disk-back', type: 'button', onClick: back, disabled: stack.length === 0, title: '返回上一层' }, '←'),
      crumbs,
    ),
    h('div', { className: 'dsh-disk-status' }, status),
  );

  var mapBlock = [
    report === null
      ? h('div', { className: 'dsh-disk-map-skeleton' })
      : (report.scan_status === 'restricted'
          ? h('div', { className: 'dsh-disk-restricted' },
              h('div', { className: 'dsh-disk-restricted-title' }, '受 macOS 隐私保护'),
              h('div', { className: 'dsh-disk-restricted-sub' }, '这是其他 App 的数据目录，系统不授予读取权限；体积已计入上一层，但无法展开明细。'),
            )
          : h('div', { className: 'dsh-disk-map-wrap' + (pending ? ' dsh-disk-map-pending' : '') },
              treemap,
              pending ? h('div', { className: 'dsh-disk-map-veil' }, '扫描中…') : null,
            )),
    report !== null && report.scan_status !== 'restricted' && sized.length === 0
      ? h('div', { className: 'dsh-disk-empty dsh-disk-empty-map' }, '这一层没有可测量的大小（权限或空目录）')
      : null,
  ];

  var filters = sugScope === 'here'
    ? [
        { id: 'all', label: '全部' },
        { id: 'dir', label: '文件夹' },
        { id: 'file', label: '文件' },
      ]
    : [
        { id: 'all', label: '全部' },
        { id: 'safe', label: '安全' },
        { id: 'probably', label: '谨慎' },
      ];

  var suggestionRows = visible.map(function (item) {
    var isEntry = item.kind === 'entry';
    var checked = selected[item.path] !== undefined;
    var tag = item.safety === '' ? '' : (safetyLabel[item.safety] || item.safety);
    var label = isEntry ? item.name : suggestionTitle(item);
    var pathLabel = isEntry ? (item.is_dir === true ? '文件夹' : '文件') : truncatePath(item.path, 44);
    return h('div', {
      className: 'dsh-disk-suggestion' + (checked ? ' dsh-disk-suggestion-on' : ''),
      key: (isEntry ? 'e:' : 's:') + item.path,
      onClick: function () { toggle(item); },
      onMouseEnter: function () { setHoverKey(item.path); },
      onMouseLeave: function () { setHoverKey(''); },
      title: item.path + (item.note ? ' · ' + item.note : ''),
    },
      h('span', { className: 'dsh-disk-check' + (checked ? ' dsh-disk-check-on' : ''), 'aria-hidden': 'true' }, checked ? '✓' : ''),
      h('span', { className: 'dsh-disk-dot', style: { background: SAFETY_COLOR[item.safety] || (isEntry ? 'transparent' : 'gray') } }),
      h('span', { className: 'dsh-disk-sug-cat' },
        (isEntry ? (item.is_dir === true ? '▸ ' : '· ') : '') + label),
      tag !== '' ? h('span', { className: 'dsh-disk-tag dsh-disk-tag-' + item.safety }, tag) : null,
      h('span', { className: 'dsh-disk-sug-size' }, item.size === null ? '—' : formatBytes(item.size)),
      h('span', { className: 'dsh-disk-sug-path' }, pathLabel),
      h('button', {
        className: 'dsh-disk-locate',
        type: 'button',
        title: '在树图中定位',
        onClick: function (event) { event.stopPropagation(); locate(item.path); },
      }, '↗'),
    );
  });

  var selectedList = selectedItems();
  var selectedTotal = selectedList.reduce(function (sum, item) { return sum + (item.size || 0); }, 0);
  var anyManual = selectedList.some(function (item) { return item.manual === true; });
  var visiblePaths = {};
  visible.forEach(function (item) { visiblePaths[item.path] = true; });
  var hiddenSelection = selectedList.filter(function (item) { return visiblePaths[item.path] !== true; }).length;

  var actionBar = plan === null
    ? h('div', { className: 'dsh-disk-actionbar' },
        h('div', { className: 'dsh-disk-selection' },
          selectedList.length === 0
            ? h('span', { className: 'dsh-disk-dim' }, '勾选文件夹或文件后可删除')
            : h('span', { className: hiddenSelection > 0 ? 'dsh-disk-selection-warn' : '' },
                selectedList.length + ' 项 · ' + formatBytes(selectedTotal) +
                (hiddenSelection > 0 ? '（' + hiddenSelection + ' 项不在当前筛选）' : '')),
          selectedList.length === 0
            ? h('button', { className: 'dsh-disk-link', type: 'button', onClick: selectSafe }, '选中全部安全项')
            : h('button', { className: 'dsh-disk-link', type: 'button', onClick: clearSelection }, '清除选择'),
        ),
        h('button', {
          className: 'dsh-disk-primary',
          type: 'button',
          disabled: selectedList.length === 0 || busy !== '',
          onClick: startPlan,
        }, busy === 'plan' ? '生成计划…' : (anyManual ? '删除' : '清理')),
      )
    : h('div', { className: 'dsh-disk-confirm' },
        h('div', { className: 'dsh-disk-confirm-title' },
          (plan.manual === true ? '手动删除 ' : '将清理 ') + plan.items.length + ' 项 · ' + formatBytes(plan.total)),
        plan.manual === true && plan.items[0]
          ? h('div', { className: 'dsh-disk-confirm-path' }, truncatePath(plan.items[0].path, 58))
          : null,
        h('div', { className: 'dsh-disk-confirm-sub' },
          plan.manual === true
            ? '不在清理规则内；移入废纸篓后可在 Finder 中放回。'
            : '移入废纸篓，可在 Finder 中放回；计划 10 分钟内有效。'),
        h('div', { className: 'dsh-disk-confirm-actions' },
          h('button', { className: 'dsh-disk-primary', type: 'button', disabled: busy !== '', onClick: confirmPlan },
            busy === 'clean' ? '删除中…' : '确认删除'),
          h('button', { className: 'dsh-disk-ghost', type: 'button', onClick: function () { setPlan(null); } }, '取消'),
        ),
      );

  var right = h('div', { className: 'dsh-disk-right' + (scopeItems.length === 0 ? ' dsh-disk-right-empty' : '') },
    h('div', { className: 'dsh-disk-panel-head' },
      h('div', null,
        h('div', { className: 'dsh-disk-panel-title' }, sugScope === 'here' ? '当前目录' : '可清理建议'),
        h('div', { className: 'dsh-disk-panel-sub' },
          sugScope === 'here'
            ? dirCount + ' 个文件夹 · ' + fileCount + ' 个文件 · ' +
              (hereReclaim > 0 ? '可清理 ' + formatBytes(hereReclaim) : '没有可清理项')
            : formatBytes(reclaim) + ' 可回收 · 安全 ' + formatBytes(safeSum) + ' · 谨慎 ' + formatBytes(cautionSum)),
      ),
    ),
    h('div', { className: 'dsh-disk-scope' },
      h('button', {
        type: 'button',
        className: 'dsh-disk-scope-btn' + (sugScope === 'here' ? ' dsh-disk-scope-on' : ''),
        onClick: function () { setSugScope('here'); },
      }, '当前层 ' + levelItems.length),
      h('button', {
        type: 'button',
        className: 'dsh-disk-scope-btn' + (sugScope === 'all' ? ' dsh-disk-scope-on' : ''),
        onClick: function () { setSugScope('all'); },
      }, '全部建议 ' + suggestionList.length),
    ),
    scopeItems.length > 0 ? h('div', { className: 'dsh-disk-filters' }, filters.map(function (item) {
      var count = sugScope === 'here'
        ? levelItems.filter(function (s) {
            if (item.id === 'all') return true;
            if (item.id === 'dir') return s.is_dir === true;
            return s.is_dir !== true;
          }).length
        : suggestionList.filter(function (s) { return item.id === 'all' || s.safety === item.id; }).length;
      return h('button', {
        key: item.id,
        type: 'button',
        className: 'dsh-disk-chip' + (activeFilter === item.id ? ' dsh-disk-chip-on' : ''),
        onClick: function () {
          if (sugScope === 'here') setKindFilter(item.id);
          else setFilter(item.id);
        },
      }, item.label + ' ' + count);
    })) : null,
    scopeItems.length > 5
      ? h('input', {
          ref: searchRef,
          className: 'dsh-disk-search',
          type: 'search',
          placeholder: '搜索名称或路径',
          value: query,
          onChange: function (event) { setQuery(event.target.value); },
        })
      : null,
    actionBar,
    notice !== '' ? h('div', { className: 'dsh-disk-notice' }, notice) : null,
    suggestionRows.length === 0
      ? h('div', { className: 'dsh-disk-empty' },
          sugScope === 'here'
            ? (levelItems.length === 0 ? '这一层没有可显示的项目' : '没有匹配项')
            : (suggestions === null ? '正在匹配规则…'
              : (suggestionList.length === 0 ? '没有命中清理规则的可回收项' : '没有匹配项')),
          sugScope === 'here' && levelItems.length === 0
            ? h('button', { className: 'dsh-disk-link', type: 'button', onClick: function () { setSugScope('all'); } }, '看全部建议')
            : null,
        )
      : h('div', { className: 'dsh-disk-suggestions' }, suggestionRows),
  );

  var bigRows = big && Array.isArray(big.files)
    ? big.files.slice(0, 10).map(function (file) {
        return h('div', { className: 'dsh-disk-big-row', key: file.path, title: file.path + '（双击在 Finder 中显示）', onDoubleClick: function () { reveal(file.path); } },
          h('span', { className: 'dsh-disk-big-size' }, formatBytes(file.size)),
          h('span', { className: 'dsh-disk-big-path' }, truncatePath(
            (current !== null && file.path.indexOf(current + '/') === 0) ? file.path.slice(current.length + 1) : file.path, 88)),
          h('button', { className: 'dsh-disk-link', type: 'button', title: '在树图中定位其父目录', onClick: function () { locate(file.path); } }, '定位'),
          h('button', { className: 'dsh-disk-link', type: 'button', onClick: function () { reveal(file.path); } }, '显示'),
          h('button', {
            className: 'dsh-disk-link dsh-disk-danger',
            type: 'button',
            title: '移入废纸篓',
            onClick: function () { manualPlan({ path: file.path, size: file.size }); },
          }, '删除'),
        );
      })
    : [];

  var bottom = h('div', { className: 'dsh-disk-bottom' },
    h('div', { className: 'dsh-disk-bottom-head' },
      h('div', null,
        h('div', { className: 'dsh-disk-panel-title' }, '大文件 Top 10'),
        h('span', { className: 'dsh-disk-panel-sub' },
          '>100 MB' + (bigScope === 'here' && current !== null ? ' · 当前层' : '')),
      ),
      current !== null
        ? h('div', { className: 'dsh-disk-scope' },
            h('button', { type: 'button', className: 'dsh-disk-scope-btn' + (bigScope === 'here' ? ' dsh-disk-scope-on' : ''), onClick: function () { setBigScope('here'); } }, '当前层'),
            h('button', { type: 'button', className: 'dsh-disk-scope-btn' + (bigScope === 'home' ? ' dsh-disk-scope-on' : ''), onClick: function () { setBigScope('home'); } }, '全盘'),
          )
        : null,
    ),
    bigRows.length === 0
      ? h('div', { className: 'dsh-disk-empty' },
          big === null ? 'Spotlight 查询中…'
            : (bigScope === 'here' && current !== null ? '当前层没有 >100 MB 的文件' : '没有找到大文件'),
          bigScope === 'here' && current !== null
            ? h('button', { className: 'dsh-disk-link', type: 'button', onClick: function () { setBigScope('home'); } }, '看全盘')
            : null,
        )
      : h('div', { className: 'dsh-disk-big-list' }, bigRows),
  );

  var tipRule = tip !== null ? ruleByPath[tip.entry.path] : null;

  var left = h('div', { className: 'dsh-disk-left' }, mapBlock, bottom);

  return h('div', { className: 'dsh-disk-root' },
    header,
    bar,
    error !== '' ? h('div', { className: 'dsh-disk-error' }, '读取失败：' + error) : null,
    toolbar,
    h('div', { className: 'dsh-disk-main' }, left, right),
    tip !== null ? h('div', {
      className: 'dsh-disk-tip',
      style: {
        left: Math.min(tip.x + 16, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 320),
        top: Math.min(tip.y + 18, (typeof window !== 'undefined' ? window.innerHeight : 900) - 132),
      },
    },
      h('div', { className: 'dsh-disk-tip-name' }, tip.entry.name),
      h('div', { className: 'dsh-disk-tip-meta' }, formatBytes(tip.entry.size) + ' · 占当前层 ' + pct(tip.entry.size, total)),
      tipRule
        ? h('div', { className: 'dsh-disk-tip-rule' },
            '可清理 · ' + (safetyLabel[tipRule.safety] || tipRule.safety) + ' · ' + formatBytes(tipRule.size))
        : (reclaimUnder(tip.entry.path).count > 0
            ? h('div', { className: 'dsh-disk-tip-rule' },
                '含可清理 ' + reclaimUnder(tip.entry.path).count + ' 项 · ' + formatBytes(reclaimUnder(tip.entry.path).bytes))
            : null),
      h('div', { className: 'dsh-disk-tip-path' }, tip.entry.path),
      h('div', { className: 'dsh-disk-tip-hint' },
        tip.entry.restricted === true
          ? '受 macOS 隐私保护，不可展开'
          : (tip.entry.is_dir ? '单击下钻 · 双击在 Finder 中显示' : '双击在 Finder 中显示') +
            (tip.entry.size > 0 && tip.entry.restricted !== true ? ' · 右上角 × 删除' : '')),
    ) : null,
    h('div', { className: 'dsh-disk-foot' },
      '体积按实际占用块计；父子目录不重复累加；缓存优先、后台刷新。',
    ),
  );
}

function DiskIcon() {
  return h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': 'true' },
    h('path', {
      d: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6zm2 0c0 .5 2.4 1.5 6 1.5S18 6.5 18 6 15.6 4.5 12 4.5 6 5.5 6 6zm0 4v4c0 .5 2.4 1.5 6 1.5s6-1 6-1.5v-4c-1.4.7-3.6 1-6 1s-4.6-.3-6-1z',
      fill: 'currentColor',
    }),
  );
}

function apply(ctx) {
  var disposeStyles = ensureStyles();
  if (typeof ctx.effect === 'function') ctx.effect(function () { return disposeStyles; }, 'disk-ops: styles');

  ctx.slots.inject('settings.section', function () {
    return ctx.slots.register({
      name: 'settings.section',
      id: 'disk-ops',
      order: 90,
      label: function () { return '磁盘空间'; },
      inject: function () { return {}; },
    }, DiskPanel);
  });

  // Left-rail icon + keyed main panel: each panellist id addresses the
  // matching `main` key (verified against the live slot catalog).
  try {
    ctx.slots.inject('sidebar.panellist', function () {
      return ctx.slots.register({
        name: 'sidebar.panellist',
        id: 'disk-ops',
        order: 40,
        label: function () { return '磁盘空间'; },
      }, DiskIcon);
    });
  } catch (error) {
    if (typeof console !== 'undefined') console.warn('disk-ops: panellist unavailable', error);
  }
  try {
    ctx.slots.inject('main', function () {
      return ctx.slots.register({ name: 'main', key: 'disk-ops' }, DiskPanel);
    });
  } catch (error) {
    if (typeof console !== 'undefined') console.warn('disk-ops: main slot unavailable', error);
  }
}
