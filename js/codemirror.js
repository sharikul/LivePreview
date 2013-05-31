// Use this file to use CodeMirror
// CodeMirror version 3.12
//
// CodeMirror is the only global var we claim
window.CodeMirror = (function() {
  "use strict";

  // BROWSER SNIFFING

  // Crude, but necessary to handle a number of hard-to-feature-detect
  // bugs and behavior differences.
  var gecko = /gecko\/\d/i.test(navigator.userAgent);
  var ie = /MSIE \d/.test(navigator.userAgent);
  var ie_lt8 = ie && (document.documentMode == null || document.documentMode < 8);
  var ie_lt9 = ie && (document.documentMode == null || document.documentMode < 9);
  var webkit = /WebKit\//.test(navigator.userAgent);
  var qtwebkit = webkit && /Qt\/\d+\.\d+/.test(navigator.userAgent);
  var chrome = /Chrome\//.test(navigator.userAgent);
  var opera = /Opera\//.test(navigator.userAgent);
  var safari = /Apple Computer/.test(navigator.vendor);
  var khtml = /KHTML\//.test(navigator.userAgent);
  var mac_geLion = /Mac OS X 1\d\D([7-9]|\d\d)\D/.test(navigator.userAgent);
  var mac_geMountainLion = /Mac OS X 1\d\D([8-9]|\d\d)\D/.test(navigator.userAgent);
  var phantom = /PhantomJS/.test(navigator.userAgent);

  var ios = /AppleWebKit/.test(navigator.userAgent) && /Mobile\/\w+/.test(navigator.userAgent);
  // This is woefully incomplete. Suggestions for alternative methods welcome.
  var mobile = ios || /Android|webOS|BlackBerry|Opera Mini|Opera Mobi|IEMobile/i.test(navigator.userAgent);
  var mac = ios || /Mac/.test(navigator.platform);
  var windows = /windows/i.test(navigator.platform);

  var opera_version = opera && navigator.userAgent.match(/Version\/(\d*\.\d*)/);
  if (opera_version) opera_version = Number(opera_version[1]);
  // Some browsers use the wrong event properties to signal cmd/ctrl on OS X
  var flipCtrlCmd = mac && (qtwebkit || opera && (opera_version == null || opera_version < 12.11));
  var captureMiddleClick = gecko || (ie && !ie_lt9);

  // Optimize some code when these features are not used
  var sawReadOnlySpans = false, sawCollapsedSpans = false;

  // CONSTRUCTOR

  function CodeMirror(place, options) {
    if (!(this instanceof CodeMirror)) return new CodeMirror(place, options);

    this.options = options = options || {};
    // Determine effective options based on given values and defaults.
    for (var opt in defaults) if (!options.hasOwnProperty(opt) && defaults.hasOwnProperty(opt))
      options[opt] = defaults[opt];
    setGuttersForLineNumbers(options);

    var docStart = typeof options.value == "string" ? 0 : options.value.first;
    var display = this.display = makeDisplay(place, docStart);
    display.wrapper.CodeMirror = this;
    updateGutters(this);
    if (options.autofocus && !mobile) focusInput(this);

    this.state = {keyMaps: [],
                  overlays: [],
                  modeGen: 0,
                  overwrite: false, focused: false,
                  suppressEdits: false, pasteIncoming: false,
                  draggingText: false,
                  highlight: new Delayed()};

    themeChanged(this);
    if (options.lineWrapping)
      this.display.wrapper.className += " CodeMirror-wrap";

    var doc = options.value;
    if (typeof doc == "string") doc = new Doc(options.value, options.mode);
    operation(this, attachDoc)(this, doc);

    // Override magic textarea content restore that IE sometimes does
    // on our hidden textarea on reload
    if (ie) setTimeout(bind(resetInput, this, true), 20);

    registerEventHandlers(this);
    // IE throws unspecified error in certain cases, when
    // trying to access activeElement before onload
    var hasFocus; try { hasFocus = (document.activeElement == display.input); } catch(e) { }
    if (hasFocus || (options.autofocus && !mobile)) setTimeout(bind(onFocus, this), 20);
    else onBlur(this);

    operation(this, function() {
      for (var opt in optionHandlers)
        if (optionHandlers.propertyIsEnumerable(opt))
          optionHandlers[opt](this, options[opt], Init);
      for (var i = 0; i < initHooks.length; ++i) initHooks[i](this);
    })();
  }

  // DISPLAY CONSTRUCTOR

  function makeDisplay(place, docStart) {
    var d = {};

    var input = d.input = elt("textarea", null, null, "position: absolute; padding: 0; width: 1px; height: 1em; outline: none; font-size: 4px;");
    if (webkit) input.style.width = "1000px";
    else input.setAttribute("wrap", "off");
    // if border: 0; -- iOS fails to open keyboard (issue #1287)
    if (ios) input.style.border = "1px solid black";
    input.setAttribute("autocorrect", "off"); input.setAttribute("autocapitalize", "off");

    // Wraps and hides input textarea
    d.inputDiv = elt("div", [input], null, "overflow: hidden; position: relative; width: 3px; height: 0px;");
    // The actual fake scrollbars.
    d.scrollbarH = elt("div", [elt("div", null, null, "height: 1px")], "CodeMirror-hscrollbar");
    d.scrollbarV = elt("div", [elt("div", null, null, "width: 1px")], "CodeMirror-vscrollbar");
    d.scrollbarFiller = elt("div", null, "CodeMirror-scrollbar-filler");
    // DIVs containing the selection and the actual code
    d.lineDiv = elt("div");
    d.selectionDiv = elt("div", null, null, "position: relative; z-index: 1");
    // Blinky cursor, and element used to ensure cursor fits at the end of a line
    d.cursor = elt("div", "\u00a0", "CodeMirror-cursor");
    // Secondary cursor, shown when on a 'jump' in bi-directional text
    d.otherCursor = elt("div", "\u00a0", "CodeMirror-cursor CodeMirror-secondarycursor");
    // Used to measure text size
    d.measure = elt("div", null, "CodeMirror-measure");
    // Wraps everything that needs to exist inside the vertically-padded coordinate system
    d.lineSpace = elt("div", [d.measure, d.selectionDiv, d.lineDiv, d.cursor, d.otherCursor],
                         null, "position: relative; outline: none");
    // Moved around its parent to cover visible view
    d.mover = elt("div", [elt("div", [d.lineSpace], "CodeMirror-lines")], null, "position: relative");
    // Set to the height of the text, causes scrolling
    d.sizer = elt("div", [d.mover], "CodeMirror-sizer");
    // D is needed because behavior of elts with overflow: auto and padding is inconsistent across browsers
    d.heightForcer = elt("div", null, null, "position: absolute; height: " + scrollerCutOff + "px; width: 1px;");
    // Will contain the gutters, if any
    d.gutters = elt("div", null, "CodeMirror-gutters");
    d.lineGutter = null;
    // Helper element to properly size the gutter backgrounds
    var scrollerInner = elt("div", [d.sizer, d.heightForcer, d.gutters], null, "position: relative; min-height: 100%");
    // Provides scrolling
    d.scroller = elt("div", [scrollerInner], "CodeMirror-scroll");
    d.scroller.setAttribute("tabIndex", "-1");
    // The element in which the editor lives.
    d.wrapper = elt("div", [d.inputDiv, d.scrollbarH, d.scrollbarV,
                            d.scrollbarFiller, d.scroller], "CodeMirror");
    // Work around IE7 z-index bug
    if (ie_lt8) { d.gutters.style.zIndex = -1; d.scroller.style.paddingRight = 0; }
    if (place.appendChild) place.appendChild(d.wrapper); else place(d.wrapper);

    // Needed to hide big blue blinking cursor on Mobile Safari
    if (ios) input.style.width = "0px";
    if (!webkit) d.scroller.draggable = true;
    // Needed to handle Tab key in KHTML
    if (khtml) { d.inputDiv.style.height = "1px"; d.inputDiv.style.position = "absolute"; }
    // Need to set a minimum width to see the scrollbar on IE7 (but must not set it on IE8).
    else if (ie_lt8) d.scrollbarH.style.minWidth = d.scrollbarV.style.minWidth = "18px";

    // Current visible range (may be bigger than the view window).
    d.viewOffset = d.lastSizeC = 0;
    d.showingFrom = d.showingTo = docStart;

    // Used to only resize the line number gutter when necessary (when
    // the amount of lines crosses a boundary that makes its width change)
    d.lineNumWidth = d.lineNumInnerWidth = d.lineNumChars = null;
    // See readInput and resetInput
    d.prevInput = "";
    // Set to true when a non-horizontal-scrolling widget is added. As
    // an optimization, widget aligning is skipped when d is false.
    d.alignWidgets = false;
    // Flag that indicates whether we currently expect input to appear
    // (after some event like 'keypress' or 'input') and are polling
    // intensively.
    d.pollingFast = false;
    // Self-resetting timeout for the poller
    d.poll = new Delayed();

    d.cachedCharWidth = d.cachedTextHeight = null;
    d.measureLineCache = [];
    d.measureLineCachePos = 0;

    // Tracks when resetInput has punted to just putting a short
    // string instead of the (large) selection.
    d.inaccurateSelection = false;

    // Tracks the maximum line length so that the horizontal scrollbar
    // can be kept static when scrolling.
    d.maxLine = null;
    d.maxLineLength = 0;
    d.maxLineChanged = false;

    // Used for measuring wheel scrolling granularity
    d.wheelDX = d.wheelDY = d.wheelStartX = d.wheelStartY = null;

    return d;
  }

  // STATE UPDATES

  // Used to get the editor into a consistent state again when options change.

  function loadMode(cm) {
    cm.doc.mode = CodeMirror.getMode(cm.options, cm.doc.modeOption);
    cm.doc.iter(function(line) {
      if (line.stateAfter) line.stateAfter = null;
      if (line.styles) line.styles = null;
    });
    cm.doc.frontier = cm.doc.first;
    startWorker(cm, 100);
    cm.state.modeGen++;
    if (cm.curOp) regChange(cm);
  }

  function wrappingChanged(cm) {
    if (cm.options.lineWrapping) {
      cm.display.wrapper.className += " CodeMirror-wrap";
      cm.display.sizer.style.minWidth = "";
    } else {
      cm.display.wrapper.className = cm.display.wrapper.className.replace(" CodeMirror-wrap", "");
      computeMaxLength(cm);
    }
    estimateLineHeights(cm);
    regChange(cm);
    clearCaches(cm);
    setTimeout(function(){updateScrollbars(cm.display, cm.doc.height);}, 100);
  }

  function estimateHeight(cm) {
    var th = textHeight(cm.display), wrapping = cm.options.lineWrapping;
    var perLine = wrapping && Math.max(5, cm.display.scroller.clientWidth / charWidth(cm.display) - 3);
    return function(line) {
      if (lineIsHidden(cm.doc, line))
        return 0;
      else if (wrapping)
        return (Math.ceil(line.text.length / perLine) || 1) * th;
      else
        return th;
    };
  }

  function estimateLineHeights(cm) {
    var doc = cm.doc, est = estimateHeight(cm);
    doc.iter(function(line) {
      var estHeight = est(line);
      if (estHeight != line.height) updateLineHeight(line, estHeight);
    });
  }

  function keyMapChanged(cm) {
    var style = keyMap[cm.options.keyMap].style;
    cm.display.wrapper.className = cm.display.wrapper.className.replace(/\s*cm-keymap-\S+/g, "") +
      (style ? " cm-keymap-" + style : "");
  }

  function themeChanged(cm) {
    cm.display.wrapper.className = cm.display.wrapper.className.replace(/\s*cm-s-\S+/g, "") +
      cm.options.theme.replace(/(^|\s)\s*/g, " cm-s-");
    clearCaches(cm);
  }

  function guttersChanged(cm) {
    updateGutters(cm);
    regChange(cm);
  }

  function updateGutters(cm) {
    var gutters = cm.display.gutters, specs = cm.options.gutters;
    removeChildren(gutters);
    for (var i = 0; i < specs.length; ++i) {
      var gutterClass = specs[i];
      var gElt = gutters.appendChild(elt("div", null, "CodeMirror-gutter " + gutterClass));
      if (gutterClass == "CodeMirror-linenumbers") {
        cm.display.lineGutter = gElt;
        gElt.style.width = (cm.display.lineNumWidth || 1) + "px";
      }
    }
    gutters.style.display = i ? "" : "none";
  }

  function lineLength(doc, line) {
    if (line.height == 0) return 0;
    var len = line.text.length, merged, cur = line;
    while (merged = collapsedSpanAtStart(cur)) {
      var found = merged.find();
      cur = getLine(doc, found.from.line);
      len += found.from.ch - found.to.ch;
    }
    cur = line;
    while (merged = collapsedSpanAtEnd(cur)) {
      var found = merged.find();
      len -= cur.text.length - found.from.ch;
      cur = getLine(doc, found.to.line);
      len += cur.text.length - found.to.ch;
    }
    return len;
  }

  function computeMaxLength(cm) {
    var d = cm.display, doc = cm.doc;
    d.maxLine = getLine(doc, doc.first);
    d.maxLineLength = lineLength(doc, d.maxLine);
    d.maxLineChanged = true;
    doc.iter(function(line) {
      var len = lineLength(doc, line);
      if (len > d.maxLineLength) {
        d.maxLineLength = len;
        d.maxLine = line;
      }
    });
  }

  // Make sure the gutters options contains the element
  // "CodeMirror-linenumbers" when the lineNumbers option is true.
  function setGuttersForLineNumbers(options) {
    var found = false;
    for (var i = 0; i < options.gutters.length; ++i) {
      if (options.gutters[i] == "CodeMirror-linenumbers") {
        if (options.lineNumbers) found = true;
        else options.gutters.splice(i--, 1);
      }
    }
    if (!found && options.lineNumbers)
      options.gutters.push("CodeMirror-linenumbers");
  }

  // SCROLLBARS

  // Re-synchronize the fake scrollbars with the actual size of the
  // content. Optionally force a scrollTop.
  function updateScrollbars(d /* display */, docHeight) {
    var totalHeight = docHeight + paddingVert(d);
    d.sizer.style.minHeight = d.heightForcer.style.top = totalHeight + "px";
    var scrollHeight = Math.max(totalHeight, d.scroller.scrollHeight);
    var needsH = d.scroller.scrollWidth > d.scroller.clientWidth;
    var needsV = scrollHeight > d.scroller.clientHeight;
    if (needsV) {
      d.scrollbarV.style.display = "block";
      d.scrollbarV.style.bottom = needsH ? scrollbarWidth(d.measure) + "px" : "0";
      d.scrollbarV.firstChild.style.height =
        (scrollHeight - d.scroller.clientHeight + d.scrollbarV.clientHeight) + "px";
    } else d.scrollbarV.style.display = "";
    if (needsH) {
      d.scrollbarH.style.display = "block";
      d.scrollbarH.style.right = needsV ? scrollbarWidth(d.measure) + "px" : "0";
      d.scrollbarH.firstChild.style.width =
        (d.scroller.scrollWidth - d.scroller.clientWidth + d.scrollbarH.clientWidth) + "px";
    } else d.scrollbarH.style.display = "";
    if (needsH && needsV) {
      d.scrollbarFiller.style.display = "block";
      d.scrollbarFiller.style.height = d.scrollbarFiller.style.width = scrollbarWidth(d.measure) + "px";
    } else d.scrollbarFiller.style.display = "";

    if (mac_geLion && scrollbarWidth(d.measure) === 0)
      d.scrollbarV.style.minWidth = d.scrollbarH.style.minHeight = mac_geMountainLion ? "18px" : "12px";
  }

  function visibleLines(display, doc, viewPort) {
    var top = display.scroller.scrollTop, height = display.wrapper.clientHeight;
    if (typeof viewPort == "number") top = viewPort;
    else if (viewPort) {top = viewPort.top; height = viewPort.bottom - viewPort.top;}
    top = Math.floor(top - paddingTop(display));
    var bottom = Math.ceil(top + height);
    return {from: lineAtHeight(doc, top), to: lineAtHeight(doc, bottom)};
  }

  // LINE NUMBERS

  function alignHorizontally(cm) {
    var display = cm.display;
    if (!display.alignWidgets && (!display.gutters.firstChild || !cm.options.fixedGutter)) return;
    var comp = compensateForHScroll(display) - display.scroller.scrollLeft + cm.doc.scrollLeft;
    var gutterW = display.gutters.offsetWidth, l = comp + "px";
    for (var n = display.lineDiv.firstChild; n; n = n.nextSibling) if (n.alignable) {
      for (var i = 0, a = n.alignable; i < a.length; ++i) a[i].style.left = l;
    }
    if (cm.options.fixedGutter)
      display.gutters.style.left = (comp + gutterW) + "px";
  }

  function maybeUpdateLineNumberWidth(cm) {
    if (!cm.options.lineNumbers) return false;
    var doc = cm.doc, last = lineNumberFor(cm.options, doc.first + doc.size - 1), display = cm.display;
    if (last.length != display.lineNumChars) {
      var test = display.measure.appendChild(elt("div", [elt("div", last)],
                                                 "CodeMirror-linenumber CodeMirror-gutter-elt"));
      var innerW = test.firstChild.offsetWidth, padding = test.offsetWidth - innerW;
      display.lineGutter.style.width = "";
      display.lineNumInnerWidth = Math.max(innerW, display.lineGutter.offsetWidth - padding);
      display.lineNumWidth = display.lineNumInnerWidth + padding;
      display.lineNumChars = display.lineNumInnerWidth ? last.length : -1;
      display.lineGutter.style.width = display.lineNumWidth + "px";
      return true;
    }
    return false;
  }

  function lineNumberFor(options, i) {
    return String(options.lineNumberFormatter(i + options.firstLineNumber));
  }
  function compensateForHScroll(display) {
    return getRect(display.scroller).left - getRect(display.sizer).left;
  }

  // DISPLAY DRAWING

  function updateDisplay(cm, changes, viewPort) {
    var oldFrom = cm.display.showingFrom, oldTo = cm.display.showingTo, updated;
    var visible = visibleLines(cm.display, cm.doc, viewPort);
    for (;;) {
      if (updateDisplayInner(cm, changes, visible)) {
        updated = true;
        signalLater(cm, "update", cm);
        if (cm.display.showingFrom != oldFrom || cm.display.showingTo != oldTo)
          signalLater(cm, "viewportChange", cm, cm.display.showingFrom, cm.display.showingTo);
      } else break;
      updateSelection(cm);
      updateScrollbars(cm.display, cm.doc.height);

      // Clip forced viewport to actual scrollable area
      if (viewPort)
        viewPort = Math.min(cm.display.scroller.scrollHeight - cm.display.scroller.clientHeight,
                            typeof viewPort == "number" ? viewPort : viewPort.top);
      visible = visibleLines(cm.display, cm.doc, viewPort);
      if (visible.from >= cm.display.showingFrom && visible.to <= cm.display.showingTo)
        break;
      changes = [];
    }

    return updated;
  }

  // Uses a set of changes plus the current scroll position to
  // determine which DOM updates have to be made, and makes the
  // updates.
  function updateDisplayInner(cm, changes, visible) {
    var display = cm.display, doc = cm.doc;
    if (!display.wrapper.clientWidth) {
      display.showingFrom = display.showingTo = doc.first;
      display.viewOffset = 0;
      return;
    }

    // Bail out if the visible area is already rendered and nothing changed.
    if (changes.length == 0 &&
        visible.from > display.showingFrom && visible.to < display.showingTo)
      return;

    if (maybeUpdateLineNumberWidth(cm))
      changes = [{from: doc.first, to: doc.first + doc.size}];
    var gutterW = display.sizer.style.marginLeft = display.gutters.offsetWidth + "px";
    display.scrollbarH.style.left = cm.options.fixedGutter ? gutterW : "0";

    // Used to determine which lines need their line numbers updated
    var positionsChangedFrom = Infinity;
    if (cm.options.lineNumbers)
      for (var i = 0; i < changes.length; ++i)
        if (changes[i].diff) { positionsChangedFrom = changes[i].from; break; }

    var end = doc.first + doc.size;
    var from = Math.max(visible.from - cm.options.viewportMargin, doc.first);
    var to = Math.min(end, visible.to + cm.options.viewportMargin);
    if (display.showingFrom < from && from - display.showingFrom < 20) from = Math.max(doc.first, display.showingFrom);
    if (display.showingTo > to && display.showingTo - to < 20) to = Math.min(end, display.showingTo);
    if (sawCollapsedSpans) {
      from = lineNo(visualLine(doc, getLine(doc, from)));
      while (to < end && lineIsHidden(doc, getLine(doc, to))) ++to;
    }

    // Create a range of theoretically intact lines, and punch holes
    // in that using the change info.
    var intact = [{from: Math.max(display.showingFrom, doc.first),
                   to: Math.min(display.showingTo, end)}];
    if (intact[0].from >= intact[0].to) intact = [];
    else intact = computeIntact(intact, changes);
    // When merged lines are present, we might have to reduce the
    // intact ranges because changes in continued fragments of the
    // intact lines do require the lines to be redrawn.
    if (sawCollapsedSpans)
      for (var i = 0; i < intact.length; ++i) {
        var range = intact[i], merged;
        while (merged = collapsedSpanAtEnd(getLine(doc, range.to - 1))) {
          var newTo = merged.find().from.line;
          if (newTo > range.from) range.to = newTo;
          else { intact.splice(i--, 1); break; }
        }
      }

    // Clip off the parts that won't be visible
    var intactLines = 0;
    for (var i = 0; i < intact.length; ++i) {
      var range = intact[i];
      if (range.from < from) range.from = from;
      if (range.to > to) range.to = to;
      if (range.from >= range.to) intact.splice(i--, 1);
      else intactLines += range.to - range.from;
    }
    if (intactLines == to - from && from == display.showingFrom && to == display.showingTo) {
      updateViewOffset(cm);
      return;
    }
    intact.sort(function(a, b) {return a.from - b.from;});

    // Avoid crashing on IE's "unspecified error" when in iframes
    try {
      var focused = document.activeElement;
    } catch(e) {}
    if (intactLines < (to - from) * .7) display.lineDiv.style.display = "none";
    patchDisplay(cm, from, to, intact, positionsChangedFrom);
    display.lineDiv.style.display = "";
    if (focused && document.activeElement != focused && focused.offsetHeight) focused.focus();

    var different = from != display.showingFrom || to != display.showingTo ||
      display.lastSizeC != display.wrapper.clientHeight;
    // This is just a bogus formula that detects when the editor is
    // resized or the font size changes.
    if (different) display.lastSizeC = display.wrapper.clientHeight;
    display.showingFrom = from; display.showingTo = to;
    startWorker(cm, 100);

    var prevBottom = display.lineDiv.offsetTop;
    for (var node = display.lineDiv.firstChild, height; node; node = node.nextSibling) if (node.lineObj) {
      if (ie_lt8) {
        var bot = node.offsetTop + node.offsetHeight;
        height = bot - prevBottom;
        prevBottom = bot;
      } else {
        var box = getRect(node);
        height = box.bottom - box.top;
      }
      var diff = node.lineObj.height - height;
      if (height < 2) height = textHeight(display);
      if (diff > .001 || diff < -.001) {
        updateLineHeight(node.lineObj, height);
        var widgets = node.lineObj.widgets;
        if (widgets) for (var i = 0; i < widgets.length; ++i)
          widgets[i].height = widgets[i].node.offsetHeight;
      }
    }
    updateViewOffset(cm);

    return true;
  }

  function updateViewOffset(cm) {
    var off = cm.display.viewOffset = heightAtLine(cm, getLine(cm.doc, cm.display.showingFrom));
    // Position the mover div to align with the current virtual scroll position
    cm.display.mover.style.top = off + "px";
  }

  function computeIntact(intact, changes) {
    for (var i = 0, l = changes.length || 0; i < l; ++i) {
      var change = changes[i], intact2 = [], diff = change.diff || 0;
      for (var j = 0, l2 = intact.length; j < l2; ++j) {
        var range = intact[j];
        if (change.to <= range.from && change.diff) {
          intact2.push({from: range.from + diff, to: range.to + diff});
        } else if (change.to <= range.from || change.from >= range.to) {
          intact2.push(range);
        } else {
          if (change.from > range.from)
            intact2.push({from: range.from, to: change.from});
          if (change.to < range.to)
            intact2.push({from: change.to + diff, to: range.to + diff});
        }
      }
      intact = intact2;
    }
    return intact;
  }

  function getDimensions(cm) {
    var d = cm.display, left = {}, width = {};
    for (var n = d.gutters.firstChild, i = 0; n; n = n.nextSibling, ++i) {
      left[cm.options.gutters[i]] = n.offsetLeft;
      width[cm.options.gutters[i]] = n.offsetWidth;
    }
    return {fixedPos: compensateForHScroll(d),
            gutterTotalWidth: d.gutters.offsetWidth,
            gutterLeft: left,
            gutterWidth: width,
            wrapperWidth: d.wrapper.clientWidth};
  }

  function patchDisplay(cm, from, to, intact, updateNumbersFrom) {
    var dims = getDimensions(cm);
    var display = cm.display, lineNumbers = cm.options.lineNumbers;
    if (!intact.length && (!webkit || !cm.display.currentWheelTarget))
      removeChildren(display.lineDiv);
    var container = display.lineDiv, cur = container.firstChild;

    function rm(node) {
      var next = node.nextSibling;
      if (webkit && mac && cm.display.currentWheelTarget == node) {
        node.style.display = "none";
        node.lineObj = null;
      } else {
        node.parentNode.removeChild(node);
      }
      return next;
    }

    var nextIntact = intact.shift(), lineN = from;
    cm.doc.iter(from, to, function(line) {
      if (nextIntact && nextIntact.to == lineN) nextIntact = intact.shift();
      if (lineIsHidden(cm.doc, line)) {
        if (line.height != 0) updateLineHeight(line, 0);
        if (line.widgets && cur.previousSibling) for (var i = 0; i < line.widgets.length; ++i)
          if (line.widgets[i].showIfHidden) {
            var prev = cur.previousSibling;
            if (/pre/i.test(prev.nodeName)) {
              var wrap = elt("div", null, null, "position: relative");
              prev.parentNode.replaceChild(wrap, prev);
              wrap.appendChild(prev);
              prev = wrap;
            }
            var wnode = prev.appendChild(elt("div", [line.widgets[i].node], "CodeMirror-linewidget"));
            positionLineWidget(line.widgets[i], wnode, prev, dims);
          }
      } else if (nextIntact && nextIntact.from <= lineN && nextIntact.to > lineN) {
        // This line is intact. Skip to the actual node. Update its
        // line number if needed.
        while (cur.lineObj != line) cur = rm(cur);
        if (lineNumbers && updateNumbersFrom <= lineN && cur.lineNumber)
          setTextContent(cur.lineNumber, lineNumberFor(cm.options, lineN));
        cur = cur.nextSibling;
      } else {
        // For lines with widgets, make an attempt to find and reuse
        // the existing element, so that widgets aren't needlessly
        // removed and re-inserted into the dom
        if (line.widgets) for (var j = 0, search = cur, reuse; search && j < 20; ++j, search = search.nextSibling)
          if (search.lineObj == line && /div/i.test(search.nodeName)) { reuse = search; break; }
        // This line needs to be generated.
        var lineNode = buildLineElement(cm, line, lineN, dims, reuse);
        if (lineNode != reuse) {
          container.insertBefore(lineNode, cur);
        } else {
          while (cur != reuse) cur = rm(cur);
          cur = cur.nextSibling;
        }

        lineNode.lineObj = line;
      }
      ++lineN;
    });
    while (cur) cur = rm(cur);
  }

  function buildLineElement(cm, line, lineNo, dims, reuse) {
    var lineElement = lineContent(cm, line);
    var markers = line.gutterMarkers, display = cm.display, wrap;

    if (!cm.options.lineNumbers && !markers && !line.bgClass && !line.wrapClass && !line.widgets)
      return lineElement;

    // Lines with gutter elements, widgets or a background class need
    // to be wrapped again, and have the extra elements added to the
    // wrapper div

    if (reuse) {
      reuse.alignable = null;
      var isOk = true, widgetsSeen = 0;
      for (var n = reuse.firstChild, next; n; n = next) {
        next = n.nextSibling;
        if (!/\bCodeMirror-linewidget\b/.test(n.className)) {
          reuse.removeChild(n);
        } else {
          for (var i = 0, first = true; i < line.widgets.length; ++i) {
            var widget = line.widgets[i], isFirst = false;
            if (!widget.above) { isFirst = first; first = false; }
            if (widget.node == n.firstChild) {
              positionLineWidget(widget, n, reuse, dims);
              ++widgetsSeen;
              if (isFirst) reuse.insertBefore(lineElement, n);
              break;
            }
          }
          if (i == line.widgets.length) { isOk = false; break; }
        }
      }
      if (isOk && widgetsSeen == line.widgets.length) {
        wrap = reuse;
        reuse.className = line.wrapClass || "";
      }
    }
    if (!wrap) {
      wrap = elt("div", null, line.wrapClass, "position: relative");
      wrap.appendChild(lineElement);
    }
    // Kludge to make sure the styled element lies behind the selection (by z-index)
    if (line.bgClass)
      wrap.insertBefore(elt("div", null, line.bgClass + " CodeMirror-linebackground"), wrap.firstChild);
    if (cm.options.lineNumbers || markers) {
      var gutterWrap = wrap.insertBefore(elt("div", null, null, "position: absolute; left: " +
                                             (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) + "px"),
                                         wrap.firstChild);
      if (cm.options.fixedGutter) (wrap.alignable || (wrap.alignable = [])).push(gutterWrap);
      if (cm.options.lineNumbers && (!markers || !markers["CodeMirror-linenumbers"]))
        wrap.lineNumber = gutterWrap.appendChild(
          elt("div", lineNumberFor(cm.options, lineNo),
              "CodeMirror-linenumber CodeMirror-gutter-elt",
              "left: " + dims.gutterLeft["CodeMirror-linenumbers"] + "px; width: "
              + display.lineNumInnerWidth + "px"));
      if (markers)
        for (var k = 0; k < cm.options.gutters.length; ++k) {
          var id = cm.options.gutters[k], found = markers.hasOwnProperty(id) && markers[id];
          if (found)
            gutterWrap.appendChild(elt("div", [found], "CodeMirror-gutter-elt", "left: " +
                                       dims.gutterLeft[id] + "px; width: " + dims.gutterWidth[id] + "px"));
        }
    }
    if (ie_lt8) wrap.style.zIndex = 2;
    if (line.widgets && wrap != reuse) for (var i = 0, ws = line.widgets; i < ws.length; ++i) {
      var widget = ws[i], node = elt("div", [widget.node], "CodeMirror-linewidget");
      positionLineWidget(widget, node, wrap, dims);
      if (widget.above)
        wrap.insertBefore(node, cm.options.lineNumbers && line.height != 0 ? gutterWrap : lineElement);
      else
        wrap.appendChild(node);
      signalLater(widget, "redraw");
    }
    return wrap;
  }

  function positionLineWidget(widget, node, wrap, dims) {
    if (widget.noHScroll) {
      (wrap.alignable || (wrap.alignable = [])).push(node);
      var width = dims.wrapperWidth;
      node.style.left = dims.fixedPos + "px";
      if (!widget.coverGutter) {
        width -= dims.gutterTotalWidth;
        node.style.paddingLeft = dims.gutterTotalWidth + "px";
      }
      node.style.width = width + "px";
    }
    if (widget.coverGutter) {
      node.style.zIndex = 5;
      node.style.position = "relative";
      if (!widget.noHScroll) node.style.marginLeft = -dims.gutterTotalWidth + "px";
    }
  }

  // SELECTION / CURSOR

  function updateSelection(cm) {
    var display = cm.display;
    var collapsed = posEq(cm.doc.sel.from, cm.doc.sel.to);
    if (collapsed || cm.options.showCursorWhenSelecting)
      updateSelectionCursor(cm);
    else
      display.cursor.style.display = display.otherCursor.style.display = "none";
    if (!collapsed)
      updateSelectionRange(cm);
    else
      display.selectionDiv.style.display = "none";

    // Move the hidden textarea near the cursor to prevent scrolling artifacts
    if (cm.options.moveInputWithCursor) {
      var headPos = cursorCoords(cm, cm.doc.sel.head, "div");
      var wrapOff = getRect(display.wrapper), lineOff = getRect(display.lineDiv);
      display.inputDiv.style.top = Math.max(0, Math.min(display.wrapper.clientHeight - 10,
                                                        headPos.top + lineOff.top - wrapOff.top)) + "px";
      display.inputDiv.style.left = Math.max(0, Math.min(display.wrapper.clientWidth - 10,
                                                         headPos.left + lineOff.left - wrapOff.left)) + "px";
    }
  }

  // No selection, plain cursor
  function updateSelectionCursor(cm) {
    var display = cm.display, pos = cursorCoords(cm, cm.doc.sel.head, "div");
    display.cursor.style.left = pos.left + "px";
    display.cursor.style.top = pos.top + "px";
    display.cursor.style.height = Math.max(0, pos.bottom - pos.top) * cm.options.cursorHeight + "px";
    display.cursor.style.display = "";

    if (pos.other) {
      display.otherCursor.style.display = "";
      display.otherCursor.style.left = pos.other.left + "px";
      display.otherCursor.style.top = pos.other.top + "px";
      display.otherCursor.style.height = (pos.other.bottom - pos.other.top) * .85 + "px";
    } else { display.otherCursor.style.display = "none"; }
  }

  // Highlight selection
  function updateSelectionRange(cm) {
    var display = cm.display, doc = cm.doc, sel = cm.doc.sel;
    var fragment = document.createDocumentFragment();
    var clientWidth = display.lineSpace.offsetWidth, pl = paddingLeft(cm.display);

    function add(left, top, width, bottom) {
      if (top < 0) top = 0;
      fragment.appendChild(elt("div", null, "CodeMirror-selected", "position: absolute; left: " + left +
                               "px; top: " + top + "px; width: " + (width == null ? clientWidth - left : width) +
                               "px; height: " + (bottom - top) + "px"));
    }

    function drawForLine(line, fromArg, toArg, retTop) {
      var lineObj = getLine(doc, line);
      var lineLen = lineObj.text.length, rVal = retTop ? Infinity : -Infinity;
      function coords(ch) {
        return charCoords(cm, Pos(line, ch), "div", lineObj);
      }

      iterateBidiSections(getOrder(lineObj), fromArg || 0, toArg == null ? lineLen : toArg, function(from, to, dir) {
        var leftPos = coords(from), rightPos, left, right;
        if (from == to) {
          rightPos = leftPos;
          left = right = leftPos.left;
        } else {
          rightPos = coords(to - 1);
          if (dir == "rtl") { var tmp = leftPos; leftPos = rightPos; rightPos = tmp; }
          left = leftPos.left;
          right = rightPos.right;
        }
        if (rightPos.top - leftPos.top > 3) { // Different lines, draw top part
          add(left, leftPos.top, null, leftPos.bottom);
          left = pl;
          if (leftPos.bottom < rightPos.top) add(left, leftPos.bottom, null, rightPos.top);
        }
        if (toArg == null && to == lineLen) right = clientWidth;
        if (fromArg == null && from == 0) left = pl;
        rVal = retTop ? Math.min(rightPos.top, rVal) : Math.max(rightPos.bottom, rVal);
        if (left < pl + 1) left = pl;
        add(left, rightPos.top, right - left, rightPos.bottom);
      });
      return rVal;
    }

    if (sel.from.line == sel.to.line) {
      drawForLine(sel.from.line, sel.from.ch, sel.to.ch);
    } else {
      var fromObj = getLine(doc, sel.from.line);
      var cur = fromObj, merged, path = [sel.from.line, sel.from.ch], singleLine;
      while (merged = collapsedSpanAtEnd(cur)) {
        var found = merged.find();
        path.push(found.from.ch, found.to.line, found.to.ch);
        if (found.to.line == sel.to.line) {
          path.push(sel.to.ch);
          singleLine = true;
          break;
        }
        cur = getLine(doc, found.to.line);
      }

      // This is a single, merged line
      if (singleLine) {
        for (var i = 0; i < path.length; i += 3)
          drawForLine(path[i], path[i+1], path[i+2]);
      } else {
        var middleTop, middleBot, toObj = getLine(doc, sel.to.line);
        if (sel.from.ch)
          // Draw the first line of selection.
          middleTop = drawForLine(sel.from.line, sel.from.ch, null, false);
        else
          // Simply include it in the middle block.
          middleTop = heightAtLine(cm, fromObj) - display.viewOffset;

        if (!sel.to.ch)
          middleBot = heightAtLine(cm, toObj) - display.viewOffset;
        else
          middleBot = drawForLine(sel.to.line, collapsedSpanAtStart(toObj) ? null : 0, sel.to.ch, true);

        if (middleTop < middleBot) add(pl, middleTop, null, middleBot);
      }
    }

    removeChildrenAndAdd(display.selectionDiv, fragment);
    display.selectionDiv.style.display = "";
  }

  // Cursor-blinking
  function restartBlink(cm) {
    if (!cm.state.focused) return;
    var display = cm.display;
    clearInterval(display.blinker);
    var on = true;
    display.cursor.style.visibility = display.otherCursor.style.visibility = "";
    display.blinker = setInterval(function() {
      display.cursor.style.visibility = display.otherCursor.style.visibility = (on = !on) ? "" : "hidden";
    }, cm.options.cursorBlinkRate);
  }

  // HIGHLIGHT WORKER

  function startWorker(cm, time) {
    if (cm.doc.mode.startState && cm.doc.frontier < cm.display.showingTo)
      cm.state.highlight.set(time, bind(highlightWorker, cm));
  }

  function highlightWorker(cm) {
    var doc = cm.doc;
    if (doc.frontier < doc.first) doc.frontier = doc.first;
    if (doc.frontier >= cm.display.showingTo) return;
    var end = +new Date + cm.options.workTime;
    var state = copyState(doc.mode, getStateBefore(cm, doc.frontier));
    var changed = [], prevChange;
    doc.iter(doc.frontier, Math.min(doc.first + doc.size, cm.display.showingTo + 500), function(line) {
      if (doc.frontier >= cm.display.showingFrom) { // Visible
        var oldStyles = line.styles;
        line.styles = highlightLine(cm, line, state);
        var ischange = !oldStyles || oldStyles.length != line.styles.length;
        for (var i = 0; !ischange && i < oldStyles.length; ++i) ischange = oldStyles[i] != line.styles[i];
        if (ischange) {
          if (prevChange && prevChange.end == doc.frontier) prevChange.end++;
          else changed.push(prevChange = {start: doc.frontier, end: doc.frontier + 1});
        }
        line.stateAfter = copyState(doc.mode, state);
      } else {
        processLine(cm, line, state);
        line.stateAfter = doc.frontier % 5 == 0 ? copyState(doc.mode, state) : null;
      }
      ++doc.frontier;
      if (+new Date > end) {
        startWorker(cm, cm.options.workDelay);
        return true;
      }
    });
    if (changed.length)
      operation(cm, function() {
        for (var i = 0; i < changed.length; ++i)
          regChange(this, changed[i].start, changed[i].end);
      })();
  }

  // Finds the line to start with when starting a parse. Tries to
  // find a line with a stateAfter, so that it can start with a
  // valid state. If that fails, it returns the line with the
  // smallest indentation, which tends to need the least context to
  // parse correctly.
  function findStartLine(cm, n) {
    var minindent, minline, doc = cm.doc;
    for (var search = n, lim = n - 100; search > lim; --search) {
      if (search <= doc.first) return doc.first;
      var line = getLine(doc, search - 1);
      if (line.stateAfter) return search;
      var indented = countColumn(line.text, null, cm.options.tabSize);
      if (minline == null || minindent > indented) {
        minline = search - 1;
        minindent = indented;
      }
    }
    return minline;
  }

  function getStateBefore(cm, n) {
    var doc = cm.doc, display = cm.display;
      if (!doc.mode.startState) return true;
    var pos = findStartLine(cm, n), state = pos > doc.first && getLine(doc, pos-1).stateAfter;
    if (!state) state = startState(doc.mode);
    else state = copyState(doc.mode, state);
    doc.iter(pos, n, function(line) {
      processLine(cm, line, state);
      var save = pos == n - 1 || pos % 5 == 0 || pos >= display.showingFrom && pos < display.showingTo;
      line.stateAfter = save ? copyState(doc.mode, state) : null;
      ++pos;
    });
    return state;
  }

  // POSITION MEASUREMENT

  function paddingTop(display) {return display.lineSpace.offsetTop;}
  function paddingVert(display) {return display.mover.offsetHeight - display.lineSpace.offsetHeight;}
  function paddingLeft(display) {
    var e = removeChildrenAndAdd(display.measure, elt("pre", null, null, "text-align: left")).appendChild(elt("span", "x"));
    return e.offsetLeft;
  }

  function measureChar(cm, line, ch, data) {
    var dir = -1;
    data = data || measureLine(cm, line);

    for (var pos = ch;; pos += dir) {
      var r = data[pos];
      if (r) break;
      if (dir < 0 && pos == 0) dir = 1;
    }
    return {left: pos < ch ? r.right : r.left,
            right: pos > ch ? r.left : r.right,
            top: r.top, bottom: r.bottom};
  }

  function findCachedMeasurement(cm, line) {
    var cache = cm.display.measureLineCache;
    for (var i = 0; i < cache.length; ++i) {
      var memo = cache[i];
      if (memo.text == line.text && memo.markedSpans == line.markedSpans &&
          cm.display.scroller.clientWidth == memo.width &&
          memo.classes == line.textClass + "|" + line.bgClass + "|" + line.wrapClass)
        return memo.measure;
    }
  }

  function measureLine(cm, line) {
    // First look in the cache
    var measure = findCachedMeasurement(cm, line);
    if (!measure) {
      // Failing that, recompute and store result in cache
      measure = measureLineInner(cm, line);
      var cache = cm.display.measureLineCache;
      var memo = {text: line.text, width: cm.display.scroller.clientWidth,
                  markedSpans: line.markedSpans, measure: measure,
                  classes: line.textClass + "|" + line.bgClass + "|" + line.wrapClass};
      if (cache.length == 16) cache[++cm.display.measureLineCachePos % 16] = memo;
      else cache.push(memo);
    }
    return measure;
  }

  function measureLineInner(cm, line) {
    var display = cm.display, measure = emptyArray(line.text.length);
    var pre = lineContent(cm, line, measure);

    // IE does not cache element positions of inline elements between
    // calls to getBoundingClientRect. This makes the loop below,
    // which gathers the positions of all the characters on the line,
    // do an amount of layout work quadratic to the number of
    // characters. When line wrapping is off, we try to improve things
    // by first subdividing the line into a bunch of inline blocks, so
    // that IE can reuse most of the layout information from caches
    // for those blocks. This does interfere with line wrapping, so it
    // doesn't work when wrapping is on, but in that case the
    // situation is slightly better, since IE does cache line-wrapping
    // information and only recomputes per-line.
    if (ie && !ie_lt8 && !cm.options.lineWrapping && pre.childNodes.length > 100) {
      var fragment = document.createDocumentFragment();
      var chunk = 10, n = pre.childNodes.length;
      for (var i = 0, chunks = Math.ceil(n / chunk); i < chunks; ++i) {
        var wrap = elt("div", null, null, "display: inline-block");
        for (var j = 0; j < chunk && n; ++j) {
          wrap.appendChild(pre.firstChild);
          --n;
        }
        fragment.appendChild(wrap);
      }
      pre.appendChild(fragment);
    }

    removeChildrenAndAdd(display.measure, pre);

    var outer = getRect(display.lineDiv);
    var vranges = [], data = emptyArray(line.text.length), maxBot = pre.offsetHeight;
    // Work around an IE7/8 bug where it will sometimes have randomly
    // replaced our pre with a clone at this point.
    if (ie_lt9 && display.measure.first != pre)
      removeChildrenAndAdd(display.measure, pre);

    for (var i = 0, cur; i < measure.length; ++i) if (cur = measure[i]) {
      var size = getRect(cur);
      var top = Math.max(0, size.top - outer.top), bot = Math.min(size.bottom - outer.top, maxBot);
      for (var j = 0; j < vranges.length; j += 2) {
        var rtop = vranges[j], rbot = vranges[j+1];
        if (rtop > bot || rbot < top) continue;
        if (rtop <= top && rbot >= bot ||
            top <= rtop && bot >= rbot ||
            Math.min(bot, rbot) - Math.max(top, rtop) >= (bot - top) >> 1) {
          vranges[j] = Math.min(top, rtop);
          vranges[j+1] = Math.max(bot, rbot);
          break;
        }
      }
      if (j == vranges.length) vranges.push(top, bot);
      var right = size.right;
      if (cur.measureRight) right = getRect(cur.measureRight).left;
      data[i] = {left: size.left - outer.left, right: right - outer.left, top: j};
    }
    for (var i = 0, cur; i < data.length; ++i) if (cur = data[i]) {
      var vr = cur.top;
      cur.top = vranges[vr]; cur.bottom = vranges[vr+1];
    }

    return data;
  }

  function measureLineWidth(cm, line) {
    var hasBadSpan = false;
    if (line.markedSpans) for (var i = 0; i < line.markedSpans; ++i) {
      var sp = line.markedSpans[i];
      if (sp.collapsed && (sp.to == null || sp.to == line.text.length)) hasBadSpan = true;
    }
    var cached = !hasBadSpan && findCachedMeasurement(cm, line);
    if (cached) return measureChar(cm, line, line.text.length, cached).right;

    var pre = lineContent(cm, line);
    var end = pre.appendChild(zeroWidthElement(cm.display.measure));
    removeChildrenAndAdd(cm.display.measure, pre);
    return getRect(end).right - getRect(cm.display.lineDiv).left;
  }

  function clearCaches(cm) {
    cm.display.measureLineCache.length = cm.display.measureLineCachePos = 0;
    cm.display.cachedCharWidth = cm.display.cachedTextHeight = null;
    if (!cm.options.lineWrapping) cm.display.maxLineChanged = true;
    cm.display.lineNumChars = null;
  }

  // Context is one of "line", "div" (display.lineDiv), "local"/null (editor), or "page"
  function intoCoordSystem(cm, lineObj, rect, context) {
    if (lineObj.widgets) for (var i = 0; i < lineObj.widgets.length; ++i) if (lineObj.widgets[i].above) {
      var size = widgetHeight(lineObj.widgets[i]);
      rect.top += size; rect.bottom += size;
    }
    if (context == "line") return rect;
    if (!context) context = "local";
    var yOff = heightAtLine(cm, lineObj);
    if (context != "local") yOff -= cm.display.viewOffset;
    if (context == "page") {
      var lOff = getRect(cm.display.lineSpace);
      yOff += lOff.top + (window.pageYOffset || (document.documentElement || document.body).scrollTop);
      var xOff = lOff.left + (window.pageXOffset || (document.documentElement || document.body).scrollLeft);
      rect.left += xOff; rect.right += xOff;
    }
    rect.top += yOff; rect.bottom += yOff;
    return rect;
  }

  // Context may be "window", "page", "div", or "local"/null
  // Result is in "div" coords
  function fromCoordSystem(cm, coords, context) {
    if (context == "div") return coords;
    var left = coords.left, top = coords.top;
    if (context == "page") {
      left -= window.pageXOffset || (document.documentElement || document.body).scrollLeft;
      top -= window.pageYOffset || (document.documentElement || document.body).scrollTop;
    }
    var lineSpaceBox = getRect(cm.display.lineSpace);
    left -= lineSpaceBox.left;
    top -= lineSpaceBox.top;
    if (context == "local" || !context) {
      var editorBox = getRect(cm.display.wrapper);
      left += editorBox.left;
      top += editorBox.top;
    }
    return {left: left, top: top};
  }

  function charCoords(cm, pos, context, lineObj) {
    if (!lineObj) lineObj = getLine(cm.doc, pos.line);
    return intoCoordSystem(cm, lineObj, measureChar(cm, lineObj, pos.ch), context);
  }

  function cursorCoords(cm, pos, context, lineObj, measurement) {
    lineObj = lineObj || getLine(cm.doc, pos.line);
    if (!measurement) measurement = measureLine(cm, lineObj);
    function get(ch, right) {
      var m = measureChar(cm, lineObj, ch, measurement);
      if (right) m.left = m.right; else m.right = m.left;
      return intoCoordSystem(cm, lineObj, m, context);
    }
    var order = getOrder(lineObj), ch = pos.ch;
    if (!order) return get(ch);
    var main, other, linedir = order[0].level;
    for (var i = 0; i < order.length; ++i) {
      var part = order[i], rtl = part.level % 2, nb, here;
      if (part.from < ch && part.to > ch) return get(ch, rtl);
      var left = rtl ? part.to : part.from, right = rtl ? part.from : part.to;
      if (left == ch) {
        // IE returns bogus offsets and widths for edges where the
        // direction flips, but only for the side with the lower
        // level. So we try to use the side with the higher level.
        if (i && part.level < (nb = order[i-1]).level) here = get(nb.level % 2 ? nb.from : nb.to - 1, true);
        else here = get(rtl && part.from != part.to ? ch - 1 : ch);
        if (rtl == linedir) main = here; else other = here;
      } else if (right == ch) {
        var nb = i < order.length - 1 && order[i+1];
        if (!rtl && nb && nb.from == nb.to) continue;
        if (nb && part.level < nb.level) here = get(nb.level % 2 ? nb.to - 1 : nb.from);
        else here = get(rtl ? ch : ch - 1, true);
        if (rtl == linedir) main = here; else other = here;
      }
    }
    if (linedir && !ch) other = get(order[0].to - 1);
    if (!main) return other;
    if (other) main.other = other;
    return main;
  }

  function PosMaybeOutside(line, ch, outside) {
    var pos = new Pos(line, ch);
    if (outside) pos.outside = true;
    return pos;
  }

  // Coords must be lineSpace-local
  function coordsChar(cm, x, y) {
    var doc = cm.doc;
    y += cm.display.viewOffset;
    if (y < 0) return PosMaybeOutside(doc.first, 0, true);
    var lineNo = lineAtHeight(doc, y), last = doc.first + doc.size - 1;
    if (lineNo > last)
      return PosMaybeOutside(doc.first + doc.size - 1, getLine(doc, last).text.length, true);
    if (x < 0) x = 0;

    for (;;) {
      var lineObj = getLine(doc, lineNo);
      var found = coordsCharInner(cm, lineObj, lineNo, x, y);
      var merged = collapsedSpanAtEnd(lineObj);
      var mergedPos = merged && merged.find();
      if (merged && found.ch >= mergedPos.from.ch)
        lineNo = mergedPos.to.line;
      else
        return found;
    }
  }

  function coordsCharInner(cm, lineObj, lineNo, x, y) {
    var innerOff = y - heightAtLine(cm, lineObj);
    var wrongLine = false, adjust = 2 * cm.display.wrapper.clientWidth;
    var measurement = measureLine(cm, lineObj);

    function getX(ch) {
      var sp = cursorCoords(cm, Pos(lineNo, ch), "line",
                            lineObj, measurement);
      wrongLine = true;
      if (innerOff > sp.bottom) return sp.left - adjust;
      else if (innerOff < sp.top) return sp.left + adjust;
      else wrongLine = false;
      return sp.left;
    }

    var bidi = getOrder(lineObj), dist = lineObj.text.length;
    var from = lineLeft(lineObj), to = lineRight(lineObj);
    var fromX = getX(from), fromOutside = wrongLine, toX = getX(to), toOutside = wrongLine;

    if (x > toX) return PosMaybeOutside(lineNo, to, toOutside);
    // Do a binary search between these bounds.
    for (;;) {
      if (bidi ? to == from || to == moveVisually(lineObj, from, 1) : to - from <= 1) {
        var after = x - fromX < toX - x, ch = after ? from : to;
        while (isExtendingChar.test(lineObj.text.charAt(ch))) ++ch;
        var pos = PosMaybeOutside(lineNo, ch, after ? fromOutside : toOutside);
        pos.after = after;
        return pos;
      }
      var step = Math.ceil(dist / 2), middle = from + step;
      if (bidi) {
        middle = from;
        for (var i = 0; i < step; ++i) middle = moveVisually(lineObj, middle, 1);
      }
      var middleX = getX(middle);
      if (middleX > x) {to = middle; toX = middleX; if (toOutside = wrongLine) toX += 1000; dist = step;}
      else {from = middle; fromX = middleX; fromOutside = wrongLine; dist -= step;}
    }
  }

  var measureText;
  function textHeight(display) {
    if (display.cachedTextHeight != null) return display.cachedTextHeight;
    if (measureText == null) {
      measureText = elt("pre");
      // Measure a bunch of lines, for browsers that compute
      // fractional heights.
      for (var i = 0; i < 49; ++i) {
        measureText.appendChild(document.createTextNode("x"));
        measureText.appendChild(elt("br"));
      }
      measureText.appendChild(document.createTextNode("x"));
    }
    removeChildrenAndAdd(display.measure, measureText);
    var height = measureText.offsetHeight / 50;
    if (height > 3) display.cachedTextHeight = height;
    removeChildren(display.measure);
    return height || 1;
  }

  function charWidth(display) {
    if (display.cachedCharWidth != null) return display.cachedCharWidth;
    var anchor = elt("span", "x");
    var pre = elt("pre", [anchor]);
    removeChildrenAndAdd(display.measure, pre);
    var width = anchor.offsetWidth;
    if (width > 2) display.cachedCharWidth = width;
    return width || 10;
  }

  // OPERATIONS

  // Operations are used to wrap changes in such a way that each
  // change won't have to update the cursor and display (which would
  // be awkward, slow, and error-prone), but instead updates are
  // batched and then all combined and executed at once.

  var nextOpId = 0;
  function startOperation(cm) {
    cm.curOp = {
      // An array of ranges of lines that have to be updated. See
      // updateDisplay.
      changes: [],
      updateInput: null,
      userSelChange: null,
      textChanged: null,
      selectionChanged: false,
      cursorActivity: false,
      updateMaxLine: false,
      updateScrollPos: false,
      id: ++nextOpId
    };
    if (!delayedCallbackDepth++) delayedCallbacks = [];
  }

  function endOperation(cm) {
    var op = cm.curOp, doc = cm.doc, display = cm.display;
    cm.curOp = null;

    if (op.updateMaxLine) computeMaxLength(cm);
    if (display.maxLineChanged && !cm.options.lineWrapping && display.maxLine) {
      var width = measureLineWidth(cm, display.maxLine);
      display.sizer.style.minWidth = Math.max(0, width + 3 + scrollerCutOff) + "px";
      display.maxLineChanged = false;
      var maxScrollLeft = Math.max(0, display.sizer.offsetLeft + display.sizer.offsetWidth - display.scroller.clientWidth);
      if (maxScrollLeft < doc.scrollLeft && !op.updateScrollPos)
        setScrollLeft(cm, Math.min(display.scroller.scrollLeft, maxScrollLeft), true);
    }
    var newScrollPos, updated;
    if (op.updateScrollPos) {
      newScrollPos = op.updateScrollPos;
    } else if (op.selectionChanged && display.scroller.clientHeight) { // don't rescroll if not visible
      var coords = cursorCoords(cm, doc.sel.head);
      newScrollPos = calculateScrollPos(cm, coords.left, coords.top, coords.left, coords.bottom);
    }
    if (op.changes.length || newScrollPos && newScrollPos.scrollTop != null) {
      updated = updateDisplay(cm, op.changes, newScrollPos && newScrollPos.scrollTop);
      if (cm.display.scroller.offsetHeight) cm.doc.scrollTop = cm.display.scroller.scrollTop;
    }
    if (!updated && op.selectionChanged) updateSelection(cm);
    if (op.updateScrollPos) {
      display.scroller.scrollTop = display.scrollbarV.scrollTop = doc.scrollTop = newScrollPos.scrollTop;
      display.scroller.scrollLeft = display.scrollbarH.scrollLeft = doc.scrollLeft = newScrollPos.scrollLeft;
      alignHorizontally(cm);
      if (op.scrollToPos)
        scrollPosIntoView(cm, clipPos(cm.doc, op.scrollToPos), op.scrollToPosMargin);
    } else if (newScrollPos) {
      scrollCursorIntoView(cm);
    }
    if (op.selectionChanged) restartBlink(cm);

    if (cm.state.focused && op.updateInput)
      resetInput(cm, op.userSelChange);

    var hidden = op.maybeHiddenMarkers, unhidden = op.maybeUnhiddenMarkers;
    if (hidden) for (var i = 0; i < hidden.length; ++i)
      if (!hidden[i].lines.length) signal(hidden[i], "hide");
    if (unhidden) for (var i = 0; i < unhidden.length; ++i)
      if (unhidden[i].lines.length) signal(unhidden[i], "unhide");

    var delayed;
    if (!--delayedCallbackDepth) {
      delayed = delayedCallbacks;
      delayedCallbacks = null;
    }
    if (op.textChanged)
      signal(cm, "change", cm, op.textChanged);
    if (op.cursorActivity) signal(cm, "cursorActivity", cm);
    if (delayed) for (var i = 0; i < delayed.length; ++i) delayed[i]();
  }

  // Wraps a function in an operation. Returns the wrapped function.
  function operation(cm1, f) {
    return function() {
      var cm = cm1 || this, withOp = !cm.curOp;
      if (withOp) startOperation(cm);
      try { var result = f.apply(cm, arguments); }
      finally { if (withOp) endOperation(cm); }
      return result;
    };
  }
  function docOperation(f) {
    return function() {
      var withOp = this.cm && !this.cm.curOp, result;
      if (withOp) startOperation(this.cm);
      try { result = f.apply(this, arguments); }
      finally { if (withOp) endOperation(this.cm); }
      return result;
    };
  }
  function runInOp(cm, f) {
    var withOp = !cm.curOp, result;
    if (withOp) startOperation(cm);
    try { result = f(); }
    finally { if (withOp) endOperation(cm); }
    return result;
  }

  function regChange(cm, from, to, lendiff) {
    if (from == null) from = cm.doc.first;
    if (to == null) to = cm.doc.first + cm.doc.size;
    cm.curOp.changes.push({from: from, to: to, diff: lendiff});
  }

  // INPUT HANDLING

  function slowPoll(cm) {
    if (cm.display.pollingFast) return;
    cm.display.poll.set(cm.options.pollInterval, function() {
      readInput(cm);
      if (cm.state.focused) slowPoll(cm);
    });
  }

  function fastPoll(cm) {
    var missed = false;
    cm.display.pollingFast = true;
    function p() {
      var changed = readInput(cm);
      if (!changed && !missed) {missed = true; cm.display.poll.set(60, p);}
      else {cm.display.pollingFast = false; slowPoll(cm);}
    }
    cm.display.poll.set(20, p);
  }

  // prevInput is a hack to work with IME. If we reset the textarea
  // on every change, that breaks IME. So we look for changes
  // compared to the previous content instead. (Modern browsers have
  // events that indicate IME taking place, but these are not widely
  // supported or compatible enough yet to rely on.)
  function readInput(cm) {
    var input = cm.display.input, prevInput = cm.display.prevInput, doc = cm.doc, sel = doc.sel;
    if (!cm.state.focused || hasSelection(input) || isReadOnly(cm)) return false;
    var text = input.value;
    if (text == prevInput && posEq(sel.from, sel.to)) return false;
    if (ie && !ie_lt9 && cm.display.inputHasSelection === text) {
      resetInput(cm, true);
      return false;
    }

    var withOp = !cm.curOp;
    if (withOp) startOperation(cm);
    sel.shift = false;
    var same = 0, l = Math.min(prevInput.length, text.length);
    while (same < l && prevInput.charCodeAt(same) == text.charCodeAt(same)) ++same;
    var from = sel.from, to = sel.to;
    if (same < prevInput.length)
      from = Pos(from.line, from.ch - (prevInput.length - same));
    else if (cm.state.overwrite && posEq(from, to) && !cm.state.pasteIncoming)
      to = Pos(to.line, Math.min(getLine(doc, to.line).text.length, to.ch + (text.length - same)));
    var updateInput = cm.curOp.updateInput;
    makeChange(cm.doc, {from: from, to: to, text: splitLines(text.slice(same)),
                        origin: cm.state.pasteIncoming ? "paste" : "+input"}, "end");

    cm.curOp.updateInput = updateInput;
    if (text.length > 1000 || text.indexOf("\n") > -1) input.value = cm.display.prevInput = "";
    else cm.display.prevInput = text;
    if (withOp) endOperation(cm);
    cm.state.pasteIncoming = false;
    return true;
  }

  function resetInput(cm, user) {
    var minimal, selected, doc = cm.doc;
    if (!posEq(doc.sel.from, doc.sel.to)) {
      cm.display.prevInput = "";
      minimal = hasCopyEvent &&
        (doc.sel.to.line - doc.sel.from.line > 100 || (selected = cm.getSelection()).length > 1000);
      var content = minimal ? "-" : selected || cm.getSelection();
      cm.display.input.value = content;
      if (cm.state.focused) selectInput(cm.display.input);
      if (ie && !ie_lt9) cm.display.inputHasSelection = content;
    } else if (user) {
      cm.display.prevInput = cm.display.input.value = "";
      if (ie && !ie_lt9) cm.display.inputHasSelection = null;
    }
    cm.display.inaccurateSelection = minimal;
  }

  function focusInput(cm) {
    if (cm.options.readOnly != "nocursor" && (!mobile || document.activeElement != cm.display.input))
      cm.display.input.focus();
  }

  function isReadOnly(cm) {
    return cm.options.readOnly || cm.doc.cantEdit;
  }

  // EVENT HANDLERS

  function registerEventHandlers(cm) {
    var d = cm.display;
    on(d.scroller, "mousedown", operation(cm, onMouseDown));
    if (ie)
      on(d.scroller, "dblclick", operation(cm, function(e) {
        var pos = posFromMouse(cm, e);
        if (!pos || clickInGutter(cm, e) || eventInWidget(cm.display, e)) return;
        e_preventDefault(e);
        var word = findWordAt(getLine(cm.doc, pos.line).text, pos);
        extendSelection(cm.doc, word.from, word.to);
      }));
    else
      on(d.scroller, "dblclick", e_preventDefault);
    on(d.lineSpace, "selectstart", function(e) {
      if (!eventInWidget(d, e)) e_preventDefault(e);
    });
    // Gecko browsers fire contextmenu *after* opening the menu, at
    // which point we can't mess with it anymore. Context menu is
    // handled in onMouseDown for Gecko.
    if (!captureMiddleClick) on(d.scroller, "contextmenu", function(e) {onContextMenu(cm, e);});

    on(d.scroller, "scroll", function() {
      if (d.scroller.clientHeight) {
        setScrollTop(cm, d.scroller.scrollTop);
        setScrollLeft(cm, d.scroller.scrollLeft, true);
        signal(cm, "scroll", cm);
      }
    });
    on(d.scrollbarV, "scroll", function() {
      if (d.scroller.clientHeight) setScrollTop(cm, d.scrollbarV.scrollTop);
    });
    on(d.scrollbarH, "scroll", function() {
      if (d.scroller.clientHeight) setScrollLeft(cm, d.scrollbarH.scrollLeft);
    });

    on(d.scroller, "mousewheel", function(e){onScrollWheel(cm, e);});
    on(d.scroller, "DOMMouseScroll", function(e){onScrollWheel(cm, e);});

    function reFocus() { if (cm.state.focused) setTimeout(bind(focusInput, cm), 0); }
    on(d.scrollbarH, "mousedown", reFocus);
    on(d.scrollbarV, "mousedown", reFocus);
    // Prevent wrapper from ever scrolling
    on(d.wrapper, "scroll", function() { d.wrapper.scrollTop = d.wrapper.scrollLeft = 0; });

    function onResize() {
      // Might be a text scaling operation, clear size caches.
      d.cachedCharWidth = d.cachedTextHeight = null;
      clearCaches(cm);
      runInOp(cm, bind(regChange, cm));
    }
    on(window, "resize", onResize);
    // Above handler holds on to the editor and its data structures.
    // Here we poll to unregister it when the editor is no longer in
    // the document, so that it can be garbage-collected.
    function unregister() {
      for (var p = d.wrapper.parentNode; p && p != document.body; p = p.parentNode) {}
      if (p) setTimeout(unregister, 5000);
      else off(window, "resize", onResize);
    }
    setTimeout(unregister, 5000);

    on(d.input, "keyup", operation(cm, function(e) {
      if (cm.options.onKeyEvent && cm.options.onKeyEvent(cm, addStop(e))) return;
      if (e.keyCode == 16) cm.doc.sel.shift = false;
    }));
    on(d.input, "input", bind(fastPoll, cm));
    on(d.input, "keydown", operation(cm, onKeyDown));
    on(d.input, "keypress", operation(cm, onKeyPress));
    on(d.input, "focus", bind(onFocus, cm));
    on(d.input, "blur", bind(onBlur, cm));

    function drag_(e) {
      if (cm.options.onDragEvent && cm.options.onDragEvent(cm, addStop(e))) return;
      e_stop(e);
    }
    if (cm.options.dragDrop) {
      on(d.scroller, "dragstart", function(e){onDragStart(cm, e);});
      on(d.scroller, "dragenter", drag_);
      on(d.scroller, "dragover", drag_);
      on(d.scroller, "drop", operation(cm, onDrop));
    }
    on(d.scroller, "paste", function(e){
      if (eventInWidget(d, e)) return;
      focusInput(cm);
      fastPoll(cm);
    });
    on(d.input, "paste", function() {
      cm.state.pasteIncoming = true;
      fastPoll(cm);
    });

    function prepareCopy() {
      if (d.inaccurateSelection) {
        d.prevInput = "";
        d.inaccurateSelection = false;
        d.input.value = cm.getSelection();
        selectInput(d.input);
      }
    }
    on(d.input, "cut", prepareCopy);
    on(d.input, "copy", prepareCopy);

    // Needed to handle Tab key in KHTML
    if (khtml) on(d.sizer, "mouseup", function() {
        if (document.activeElement == d.input) d.input.blur();
        focusInput(cm);
    });
  }

  function eventInWidget(display, e) {
    for (var n = e_target(e); n != display.wrapper; n = n.parentNode) {
      if (!n) return true;
      if (/\bCodeMirror-(?:line)?widget\b/.test(n.className) ||
          n.parentNode == display.sizer && n != display.mover) return true;
    }
  }

  function posFromMouse(cm, e, liberal) {
    var display = cm.display;
    if (!liberal) {
      var target = e_target(e);
      if (target == display.scrollbarH || target == display.scrollbarH.firstChild ||
          target == display.scrollbarV || target == display.scrollbarV.firstChild ||
          target == display.scrollbarFiller) return null;
    }
    var x, y, space = getRect(display.lineSpace);
    // Fails unpredictably on IE[67] when mouse is dragged around quickly.
    try { x = e.clientX; y = e.clientY; } catch (e) { return null; }
    return coordsChar(cm, x - space.left, y - space.top);
  }

  var lastClick, lastDoubleClick;
  function onMouseDown(e) {
    var cm = this, display = cm.display, doc = cm.doc, sel = doc.sel;
    sel.shift = e.shiftKey;

    if (eventInWidget(display, e)) {
      if (!webkit) {
        display.scroller.draggable = false;
        setTimeout(function(){display.scroller.draggable = true;}, 100);
      }
      return;
    }
    if (clickInGutter(cm, e)) return;
    var start = posFromMouse(cm, e);

    switch (e_button(e)) {
    case 3:
      if (captureMiddleClick) onContextMenu.call(cm, cm, e);
      return;
    case 2:
      if (start) extendSelection(cm.doc, start);
      setTimeout(bind(focusInput, cm), 20);
      e_preventDefault(e);
      return;
    }
    // For button 1, if it was clicked inside the editor
    // (posFromMouse returning non-null), we have to adjust the
    // selection.
    if (!start) {if (e_target(e) == display.scroller) e_preventDefault(e); return;}

    if (!cm.state.focused) onFocus(cm);

    var now = +new Date, type = "single";
    if (lastDoubleClick && lastDoubleClick.time > now - 400 && posEq(lastDoubleClick.pos, start)) {
      type = "triple";
      e_preventDefault(e);
      setTimeout(bind(focusInput, cm), 20);
      selectLine(cm, start.line);
    } else if (lastClick && lastClick.time > now - 400 && posEq(lastClick.pos, start)) {
      type = "double";
      lastDoubleClick = {time: now, pos: start};
      e_preventDefault(e);
      var word = findWordAt(getLine(doc, start.line).text, start);
      extendSelection(cm.doc, word.from, word.to);
    } else { lastClick = {time: now, pos: start}; }

    var last = start;
    if (cm.options.dragDrop && dragAndDrop && !isReadOnly(cm) && !posEq(sel.from, sel.to) &&
        !posLess(start, sel.from) && !posLess(sel.to, start) && type == "single") {
      var dragEnd = operation(cm, function(e2) {
        if (webkit) display.scroller.draggable = false;
        cm.state.draggingText = false;
        off(document, "mouseup", dragEnd);
        off(display.scroller, "drop", dragEnd);
        if (Math.abs(e.clientX - e2.clientX) + Math.abs(e.clientY - e2.clientY) < 10) {
          e_preventDefault(e2);
          extendSelection(cm.doc, start);
          focusInput(cm);
        }
      });
      // Let the drag handler handle this.
      if (webkit) display.scroller.draggable = true;
      cm.state.draggingText = dragEnd;
      // IE's approach to draggable
      if (display.scroller.dragDrop) display.scroller.dragDrop();
      on(document, "mouseup", dragEnd);
      on(display.scroller, "drop", dragEnd);
      return;
    }
    e_preventDefault(e);
    if (type == "single") extendSelection(cm.doc, clipPos(doc, start));

    var startstart = sel.from, startend = sel.to, lastPos = start;

    function doSelect(cur) {
      if (posEq(lastPos, cur)) return;
      lastPos = cur;

      if (type == "single") {
        extendSelection(cm.doc, clipPos(doc, start), cur);
        return;
      }

      startstart = clipPos(doc, startstart);
      startend = clipPos(doc, startend);
      if (type == "double") {
        var word = findWordAt(getLine(doc, cur.line).text, cur);
        if (posLess(cur, startstart)) extendSelection(cm.doc, word.from, startend);
        else extendSelection(cm.doc, startstart, word.to);
      } else if (type == "triple") {
        if (posLess(cur, startstart)) extendSelection(cm.doc, startend, clipPos(doc, Pos(cur.line, 0)));
        else extendSelection(cm.doc, startstart, clipPos(doc, Pos(cur.line + 1, 0)));
      }
    }

    var editorSize = getRect(display.wrapper);
    // Used to ensure timeout re-tries don't fire when another extend
    // happened in the meantime (clearTimeout isn't reliable -- at
    // least on Chrome, the timeouts still happen even when cleared,
    // if the clear happens after their scheduled firing time).
    var counter = 0;

    function extend(e) {
      var curCount = ++counter;
      var cur = posFromMouse(cm, e, true);
      if (!cur) return;
      if (!posEq(cur, last)) {
        if (!cm.state.focused) onFocus(cm);
        last = cur;
        doSelect(cur);
        var visible = visibleLines(display, doc);
        if (cur.line >= visible.to || cur.line < visible.from)
          setTimeout(operation(cm, function(){if (counter == curCount) extend(e);}), 150);
      } else {
        var outside = e.clientY < editorSize.top ? -20 : e.clientY > editorSize.bottom ? 20 : 0;
        if (outside) setTimeout(operation(cm, function() {
          if (counter != curCount) return;
          display.scroller.scrollTop += outside;
          extend(e);
        }), 50);
      }
    }

    function done(e) {
      counter = Infinity;
      var cur = posFromMouse(cm, e);
      if (cur) doSelect(cur);
      e_preventDefault(e);
      focusInput(cm);
      off(document, "mousemove", move);
      off(document, "mouseup", up);
    }

    var move = operation(cm, function(e) {
      if (!ie && !e_button(e)) done(e);
      else extend(e);
    });
    var up = operation(cm, done);
    on(document, "mousemove", move);
    on(document, "mouseup", up);
  }

  function onDrop(e) {
    var cm = this;
    if (eventInWidget(cm.display, e) || (cm.options.onDragEvent && cm.options.onDragEvent(cm, addStop(e))))
      return;
    e_preventDefault(e);
    var pos = posFromMouse(cm, e, true), files = e.dataTransfer.files;
    if (!pos || isReadOnly(cm)) return;
    if (files && files.length && window.FileReader && window.File) {
      var n = files.length, text = Array(n), read = 0;
      var loadFile = function(file, i) {
        var reader = new FileReader;
        reader.onload = function() {
          text[i] = reader.result;
          if (++read == n) {
            pos = clipPos(cm.doc, pos);
            makeChange(cm.doc, {from: pos, to: pos, text: splitLines(text.join("\n")), origin: "paste"}, "around");
          }
        };
        reader.readAsText(file);
      };
      for (var i = 0; i < n; ++i) loadFile(files[i], i);
    } else {
      // Don't do a replace if the drop happened inside of the selected text.
      if (cm.state.draggingText && !(posLess(pos, cm.doc.sel.from) || posLess(cm.doc.sel.to, pos))) {
        cm.state.draggingText(e);
        // Ensure the editor is re-focused
        setTimeout(bind(focusInput, cm), 20);
        return;
      }
      try {
        var text = e.dataTransfer.getData("Text");
        if (text) {
          var curFrom = cm.doc.sel.from, curTo = cm.doc.sel.to;
          setSelection(cm.doc, pos, pos);
          if (cm.state.draggingText) replaceRange(cm.doc, "", curFrom, curTo, "paste");
          cm.replaceSelection(text, null, "paste");
          focusInput(cm);
          onFocus(cm);
        }
      }
      catch(e){}
    }
  }

  function clickInGutter(cm, e) {
    var display = cm.display;
    try { var mX = e.clientX, mY = e.clientY; }
    catch(e) { return false; }

    if (mX >= Math.floor(getRect(display.gutters).right)) return false;
    e_preventDefault(e);
    if (!hasHandler(cm, "gutterClick")) return true;

    var lineBox = getRect(display.lineDiv);
    if (mY > lineBox.bottom) return true;
    mY -= lineBox.top - display.viewOffset;

    for (var i = 0; i < cm.options.gutters.length; ++i) {
      var g = display.gutters.childNodes[i];
      if (g && getRect(g).right >= mX) {
        var line = lineAtHeight(cm.doc, mY);
        var gutter = cm.options.gutters[i];
        signalLater(cm, "gutterClick", cm, line, gutter, e);
        break;
      }
    }
    return true;
  }

  function onDragStart(cm, e) {
    if (ie && !cm.state.draggingText) { e_stop(e); return; }
    if (eventInWidget(cm.display, e)) return;

    var txt = cm.getSelection();
    e.dataTransfer.setData("Text", txt);

    // Use dummy image instead of default browsers image.
    // Recent Safari (~6.0.2) have a tendency to segfault when this happens, so we don't do it there.
    if (e.dataTransfer.setDragImage) {
      var img = elt("img", null, null, "position: fixed; left: 0; top: 0;");
      if (opera) {
        img.width = img.height = 1;
        cm.display.wrapper.appendChild(img);
        // Force a relayout, or Opera won't use our image for some obscure reason
        img._top = img.offsetTop;
      }
      if (safari) {
        if (cm.display.dragImg) {
          img = cm.display.dragImg;
        } else {
          cm.display.dragImg = img;
          img.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
          cm.display.wrapper.appendChild(img);
        }
      }
      e.dataTransfer.setDragImage(img, 0, 0);
      if (opera) img.parentNode.removeChild(img);
    }
  }

  function setScrollTop(cm, val) {
    if (Math.abs(cm.doc.scrollTop - val) < 2) return;
    cm.doc.scrollTop = val;
    if (!gecko) updateDisplay(cm, [], val);
    if (cm.display.scroller.scrollTop != val) cm.display.scroller.scrollTop = val;
    if (cm.display.scrollbarV.scrollTop != val) cm.display.scrollbarV.scrollTop = val;
    if (gecko) updateDisplay(cm, []);
  }
  function setScrollLeft(cm, val, isScroller) {
    if (isScroller ? val == cm.doc.scrollLeft : Math.abs(cm.doc.scrollLeft - val) < 2) return;
    val = Math.min(val, cm.display.scroller.scrollWidth - cm.display.scroller.clientWidth);
    cm.doc.scrollLeft = val;
    alignHorizontally(cm);
    if (cm.display.scroller.scrollLeft != val) cm.display.scroller.scrollLeft = val;
    if (cm.display.scrollbarH.scrollLeft != val) cm.display.scrollbarH.scrollLeft = val;
  }

  // Since the delta values reported on mouse wheel events are
  // unstandardized between browsers and even browser versions, and
  // generally horribly unpredictable, this code starts by measuring
  // the scroll effect that the first few mouse wheel events have,
  // and, from that, detects the way it can convert deltas to pixel
  // offsets afterwards.
  //
  // The reason we want to know the amount a wheel event will scroll
  // is that it gives us a chance to update the display before the
  // actual scrolling happens, reducing flickering.

  var wheelSamples = 0, wheelPixelsPerUnit = null;
  // Fill in a browser-detected starting value on browsers where we
  // know one. These don't have to be accurate -- the result of them
  // being wrong would just be a slight flicker on the first wheel
  // scroll (if it is large enough).
  if (ie) wheelPixelsPerUnit = -.53;
  else if (gecko) wheelPixelsPerUnit = 15;
  else if (chrome) wheelPixelsPerUnit = -.7;
  else if (safari) wheelPixelsPerUnit = -1/3;

  function onScrollWheel(cm, e) {
    var dx = e.wheelDeltaX, dy = e.wheelDeltaY;
    if (dx == null && e.detail && e.axis == e.HORIZONTAL_AXIS) dx = e.detail;
    if (dy == null && e.detail && e.axis == e.VERTICAL_AXIS) dy = e.detail;
    else if (dy == null) dy = e.wheelDelta;

    var display = cm.display, scroll = display.scroller;
    // Quit if there's nothing to scroll here
    if (!(dx && scroll.scrollWidth > scroll.clientWidth ||
          dy && scroll.scrollHeight > scroll.clientHeight)) return;

    // Webkit browsers on OS X abort momentum scrolls when the target
    // of the scroll event is removed from the scrollable element.
    // This hack (see related code in patchDisplay) makes sure the
    // element is kept around.
    if (dy && mac && webkit) {
      for (var cur = e.target; cur != scroll; cur = cur.parentNode) {
        if (cur.lineObj) {
          cm.display.currentWheelTarget = cur;
          break;
        }
      }
    }

    // On some browsers, horizontal scrolling will cause redraws to
    // happen before the gutter has been realigned, causing it to
    // wriggle around in a most unseemly way. When we have an
    // estimated pixels/delta value, we just handle horizontal
    // scrolling entirely here. It'll be slightly off from native, but
    // better than glitching out.
    if (dx && !gecko && !opera && wheelPixelsPerUnit != null) {
      if (dy)
        setScrollTop(cm, Math.max(0, Math.min(scroll.scrollTop + dy * wheelPixelsPerUnit, scroll.scrollHeight - scroll.clientHeight)));
      setScrollLeft(cm, Math.max(0, Math.min(scroll.scrollLeft + dx * wheelPixelsPerUnit, scroll.scrollWidth - scroll.clientWidth)));
      e_preventDefault(e);
      display.wheelStartX = null; // Abort measurement, if in progress
      return;
    }

    if (dy && wheelPixelsPerUnit != null) {
      var pixels = dy * wheelPixelsPerUnit;
      var top = cm.doc.scrollTop, bot = top + display.wrapper.clientHeight;
      if (pixels < 0) top = Math.max(0, top + pixels - 50);
      else bot = Math.min(cm.doc.height, bot + pixels + 50);
      updateDisplay(cm, [], {top: top, bottom: bot});
    }

    if (wheelSamples < 20) {
      if (display.wheelStartX == null) {
        display.wheelStartX = scroll.scrollLeft; display.wheelStartY = scroll.scrollTop;
        display.wheelDX = dx; display.wheelDY = dy;
        setTimeout(function() {
          if (display.wheelStartX == null) return;
          var movedX = scroll.scrollLeft - display.wheelStartX;
          var movedY = scroll.scrollTop - display.wheelStartY;
          var sample = (movedY && display.wheelDY && movedY / display.wheelDY) ||
            (movedX && display.wheelDX && movedX / display.wheelDX);
          display.wheelStartX = display.wheelStartY = null;
          if (!sample) return;
          wheelPixelsPerUnit = (wheelPixelsPerUnit * wheelSamples + sample) / (wheelSamples + 1);
          ++wheelSamples;
        }, 200);
      } else {
        display.wheelDX += dx; display.wheelDY += dy;
      }
    }
  }

  function doHandleBinding(cm, bound, dropShift) {
    if (typeof bound == "string") {
      bound = commands[bound];
      if (!bound) return false;
    }
    // Ensure previous input has been read, so that the handler sees a
    // consistent view of the document
    if (cm.display.pollingFast && readInput(cm)) cm.display.pollingFast = false;
    var doc = cm.doc, prevShift = doc.sel.shift, done = false;
    try {
      if (isReadOnly(cm)) cm.state.suppressEdits = true;
      if (dropShift) doc.sel.shift = false;
      done = bound(cm) != Pass;
    } finally {
      doc.sel.shift = prevShift;
      cm.state.suppressEdits = false;
    }
    return done;
  }

  function allKeyMaps(cm) {
    var maps = cm.state.keyMaps.slice(0);
    if (cm.options.extraKeys) maps.push(cm.options.extraKeys);
    maps.push(cm.options.keyMap);
    return maps;
  }

  var maybeTransition;
  function handleKeyBinding(cm, e) {
    // Handle auto keymap transitions
    var startMap = getKeyMap(cm.options.keyMap), next = startMap.auto;
    clearTimeout(maybeTransition);
    if (next && !isModifierKey(e)) maybeTransition = setTimeout(function() {
      if (getKeyMap(cm.options.keyMap) == startMap)
        cm.options.keyMap = (next.call ? next.call(null, cm) : next);
    }, 50);

    var name = keyName(e, true), handled = false;
    if (!name) return false;
    var keymaps = allKeyMaps(cm);

    if (e.shiftKey) {
      // First try to resolve full name (including 'Shift-'). Failing
      // that, see if there is a cursor-motion command (starting with
      // 'go') bound to the keyname without 'Shift-'.
      handled = lookupKey("Shift-" + name, keymaps, function(b) {return doHandleBinding(cm, b, true);})
             || lookupKey(name, keymaps, function(b) {
                  if (typeof b == "string" && /^go[A-Z]/.test(b)) return doHandleBinding(cm, b);
                });
    } else {
      handled = lookupKey(name, keymaps, function(b) { return doHandleBinding(cm, b); });
    }
    if (handled == "stop") handled = false;

    if (handled) {
      e_preventDefault(e);
      restartBlink(cm);
      if (ie_lt9) { e.oldKeyCode = e.keyCode; e.keyCode = 0; }
    }
    return handled;
  }

  function handleCharBinding(cm, e, ch) {
    var handled = lookupKey("'" + ch + "'", allKeyMaps(cm),
                            function(b) { return doHandleBinding(cm, b, true); });
    if (handled) {
      e_preventDefault(e);
      restartBlink(cm);
    }
    return handled;
  }

  var lastStoppedKey = null;
  function onKeyDown(e) {
    var cm = this;
    if (!cm.state.focused) onFocus(cm);
    if (ie && e.keyCode == 27) { e.returnValue = false; }
    if (cm.options.onKeyEvent && cm.options.onKeyEvent(cm, addStop(e))) return;
    var code = e.keyCode;
    // IE does strange things with escape.
    cm.doc.sel.shift = code == 16 || e.shiftKey;
    // First give onKeyEvent option a chance to handle this.
    var handled = handleKeyBinding(cm, e);
    if (opera) {
      lastStoppedKey = handled ? code : null;
      // Opera has no cut event... we try to at least catch the key combo
      if (!handled && code == 88 && !hasCopyEvent && (mac ? e.metaKey : e.ctrlKey))
        cm.replaceSelection("");
    }
  }

  function onKeyPress(e) {
    var cm = this;
    if (cm.options.onKeyEvent && cm.options.onKeyEvent(cm, addStop(e))) return;
    var keyCode = e.keyCode, charCode = e.charCode;
    if (opera && keyCode == lastStoppedKey) {lastStoppedKey = null; e_preventDefault(e); return;}
    if (((opera && (!e.which || e.which < 10)) || khtml) && handleKeyBinding(cm, e)) return;
    var ch = String.fromCharCode(charCode == null ? keyCode : charCode);
    if (this.options.electricChars && this.doc.mode.electricChars &&
        this.options.smartIndent && !isReadOnly(this) &&
        this.doc.mode.electricChars.indexOf(ch) > -1)
      setTimeout(operation(cm, function() {indentLine(cm, cm.doc.sel.to.line, "smart");}), 75);
    if (handleCharBinding(cm, e, ch)) return;
    if (ie && !ie_lt9) cm.display.inputHasSelection = null;
    fastPoll(cm);
  }

  function onFocus(cm) {
    if (cm.options.readOnly == "nocursor") return;
    if (!cm.state.focused) {
      signal(cm, "focus", cm);
      cm.state.focused = true;
      if (cm.display.wrapper.className.search(/\bCodeMirror-focused\b/) == -1)
        cm.display.wrapper.className += " CodeMirror-focused";
      resetInput(cm, true);
    }
    slowPoll(cm);
    restartBlink(cm);
  }
  function onBlur(cm) {
    if (cm.state.focused) {
      signal(cm, "blur", cm);
      cm.state.focused = false;
      cm.display.wrapper.className = cm.display.wrapper.className.replace(" CodeMirror-focused", "");
    }
    clearInterval(cm.display.blinker);
    setTimeout(function() {if (!cm.state.focused) cm.doc.sel.shift = false;}, 150);
  }

  var detectingSelectAll;
  function onContextMenu(cm, e) {
    var display = cm.display, sel = cm.doc.sel;
    if (eventInWidget(display, e)) return;

    var pos = posFromMouse(cm, e), scrollPos = display.scroller.scrollTop;
    if (!pos || opera) return; // Opera is difficult.
    if (posEq(sel.from, sel.to) || posLess(pos, sel.from) || !posLess(pos, sel.to))
      operation(cm, setSelection)(cm.doc, pos, pos);

    var oldCSS = display.input.style.cssText;
    display.inputDiv.style.position = "absolute";
    display.input.style.cssText = "position: fixed; width: 30px; height: 30px; top: " + (e.clientY - 5) +
      "px; left: " + (e.clientX - 5) + "px; z-index: 1000; background: white; outline: none;" +
      "border-width: 0; outline: none; overflow: hidden; opacity: .05; -ms-opacity: .05; filter: alpha(opacity=5);";
    focusInput(cm);
    resetInput(cm, true);
    // Adds "Select all" to context menu in FF
    if (posEq(sel.from, sel.to)) display.input.value = display.prevInput = " ";

    function rehide() {
      display.inputDiv.style.position = "relative";
      display.input.style.cssText = oldCSS;
      if (ie_lt9) display.scrollbarV.scrollTop = display.scroller.scrollTop = scrollPos;
      slowPoll(cm);

      // Try to detect the user choosing select-all
      if (display.input.selectionStart != null && (!ie || ie_lt9)) {
        clearTimeout(detectingSelectAll);
        var extval = display.input.value = " " + (posEq(sel.from, sel.to) ? "" : display.input.value), i = 0;
        display.prevInput = " ";
        display.input.selectionStart = 1; display.input.selectionEnd = extval.length;
        var poll = function(){
          if (display.prevInput == " " && display.input.selectionStart == 0)
            operation(cm, commands.selectAll)(cm);
          else if (i++ < 10) detectingSelectAll = setTimeout(poll, 500);
          else resetInput(cm);
        };
        detectingSelectAll = setTimeout(poll, 200);
      }
    }

    if (captureMiddleClick) {
      e_stop(e);
      var mouseup = function() {
        off(window, "mouseup", mouseup);
        setTimeout(rehide, 20);
      };
      on(window, "mouseup", mouseup);
    } else {
      setTimeout(rehide, 50);
    }
  }

  // UPDATING

  function changeEnd(change) {
    if (!change.text) return change.to;
    return Pos(change.from.line + change.text.length - 1,
               lst(change.text).length + (change.text.length == 1 ? change.from.ch : 0));
  }

  // Make sure a position will be valid after the given change.
  function clipPostChange(doc, change, pos) {
    if (!posLess(change.from, pos)) return clipPos(doc, pos);
    var diff = (change.text.length - 1) - (change.to.line - change.from.line);
    if (pos.line > change.to.line + diff) {
      var preLine = pos.line - diff, lastLine = doc.first + doc.size - 1;
      if (preLine > lastLine) return Pos(lastLine, getLine(doc, lastLine).text.length);
      return clipToLen(pos, getLine(doc, preLine).text.length);
    }
    if (pos.line == change.to.line + diff)
      return clipToLen(pos, lst(change.text).length + (change.text.length == 1 ? change.from.ch : 0) +
                       getLine(doc, change.to.line).text.length - change.to.ch);
    var inside = pos.line - change.from.line;
    return clipToLen(pos, change.text[inside].length + (inside ? 0 : change.from.ch));
  }

  // Hint can be null|"end"|"start"|"around"|{anchor,head}
  function computeSelAfterChange(doc, change, hint) {
    if (hint && typeof hint == "object") // Assumed to be {anchor, head} object
      return {anchor: clipPostChange(doc, change, hint.anchor),
              head: clipPostChange(doc, change, hint.head)};

    if (hint == "start") return {anchor: change.from, head: change.from};

    var end = changeEnd(change);
    if (hint == "around") return {anchor: change.from, head: end};
    if (hint == "end") return {anchor: end, head: end};

    // hint is null, leave the selection alone as much as possible
    var adjustPos = function(pos) {
      if (posLess(pos, change.from)) return pos;
      if (!posLess(change.to, pos)) return end;

      var line = pos.line + change.text.length - (change.to.line - change.from.line) - 1, ch = pos.ch;
      if (pos.line == change.to.line) ch += end.ch - change.to.ch;
      return Pos(line, ch);
    };
    return {anchor: adjustPos(doc.sel.anchor), head: adjustPos(doc.sel.head)};
  }

  function filterChange(doc, change) {
    var obj = {
      canceled: false,
      from: change.from,
      to: change.to,
      text: change.text,
      origin: change.origin,
      update: function(from, to, text, origin) {
        if (from) this.from = clipPos(doc, from);
        if (to) this.to = clipPos(doc, to);
        if (text) this.text = text;
        if (origin !== undefined) this.origin = origin;
      },
      cancel: function() { this.canceled = true; }
    };
    signal(doc, "beforeChange", doc, obj);
    if (doc.cm) signal(doc.cm, "beforeChange", doc.cm, obj);

    if (obj.canceled) return null;
    return {from: obj.from, to: obj.to, text: obj.text, origin: obj.origin};
  }

  // Replace the range from from to to by the strings in replacement.
  // change is a {from, to, text [, origin]} object
  function makeChange(doc, change, selUpdate, ignoreReadOnly) {
    if (doc.cm) {
      if (!doc.cm.curOp) return operation(doc.cm, makeChange)(doc, change, selUpdate, ignoreReadOnly);
      if (doc.cm.state.suppressEdits) return;
    }

    if (hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange")) {
      change = filterChange(doc, change);
      if (!change) return;
    }

    // Possibly split or suppress the update based on the presence
    // of read-only spans in its range.
    var split = sawReadOnlySpans && !ignoreReadOnly && removeReadOnlyRanges(doc, change.from, change.to);
    if (split) {
      for (var i = split.length - 1; i >= 1; --i)
        makeChangeNoReadonly(doc, {from: split[i].from, to: split[i].to, text: [""]});
      if (split.length)
        makeChangeNoReadonly(doc, {from: split[0].from, to: split[0].to, text: change.text}, selUpdate);
    } else {
      makeChangeNoReadonly(doc, change, selUpdate);
    }
  }

  function makeChangeNoReadonly(doc, change, selUpdate) {
    var selAfter = computeSelAfterChange(doc, change, selUpdate);
    addToHistory(doc, change, selAfter, doc.cm ? doc.cm.curOp.id : NaN);

    makeChangeSingleDoc(doc, change, selAfter, stretchSpansOverChange(doc, change));
    var rebased = [];

    linkedDocs(doc, function(doc, sharedHist) {
      if (!sharedHist && indexOf(rebased, doc.history) == -1) {
        rebaseHist(doc.history, change);
        rebased.push(doc.history);
      }
      makeChangeSingleDoc(doc, change, null, stretchSpansOverChange(doc, change));
    });
  }

  function makeChangeFromHistory(doc, type) {
    if (doc.cm && doc.cm.state.suppressEdits) return;

    var hist = doc.history;
    var event = (type == "undo" ? hist.done : hist.undone).pop();
    if (!event) return;
    hist.dirtyCounter += type == "undo" ? -1 : 1;

    var anti = {changes: [], anchorBefore: event.anchorAfter, headBefore: event.headAfter,
                anchorAfter: event.anchorBefore, headAfter: event.headBefore};
    (type == "undo" ? hist.undone : hist.done).push(anti);

    for (var i = event.changes.length - 1; i >= 0; --i) {
      var change = event.changes[i];
      change.origin = type;
      anti.changes.push(historyChangeFromChange(doc, change));

      var after = i ? computeSelAfterChange(doc, change, null)
                    : {anchor: event.anchorBefore, head: event.headBefore};
      makeChangeSingleDoc(doc, change, after, mergeOldSpans(doc, change));
      var rebased = [];

      linkedDocs(doc, function(doc, sharedHist) {
        if (!sharedHist && indexOf(rebased, doc.history) == -1) {
          rebaseHist(doc.history, change);
          rebased.push(doc.history);
        }
        makeChangeSingleDoc(doc, change, null, mergeOldSpans(doc, change));
      });
    }
  }

  function shiftDoc(doc, distance) {
    function shiftPos(pos) {return Pos(pos.line + distance, pos.ch);}
    doc.first += distance;
    if (doc.cm) regChange(doc.cm, doc.first, doc.first, distance);
    doc.sel.head = shiftPos(doc.sel.head); doc.sel.anchor = shiftPos(doc.sel.anchor);
    doc.sel.from = shiftPos(doc.sel.from); doc.sel.to = shiftPos(doc.sel.to);
  }

  function makeChangeSingleDoc(doc, change, selAfter, spans) {
    if (doc.cm && !doc.cm.curOp)
      return operation(doc.cm, makeChangeSingleDoc)(doc, change, selAfter, spans);

    if (change.to.line < doc.first) {
      shiftDoc(doc, change.text.length - 1 - (change.to.line - change.from.line));
      return;
    }
    if (change.from.line > doc.lastLine()) return;

    // Clip the change to the size of this doc
    if (change.from.line < doc.first) {
      var shift = change.text.length - 1 - (doc.first - change.from.line);
      shiftDoc(doc, shift);
      change = {from: Pos(doc.first, 0), to: Pos(change.to.line + shift, change.to.ch),
                text: [lst(change.text)], origin: change.origin};
    }
    var last = doc.lastLine();
    if (change.to.line > last) {
      change = {from: change.from, to: Pos(last, getLine(doc, last).text.length),
                text: [change.text[0]], origin: change.origin};
    }

    change.removed = getBetween(doc, change.from, change.to);

    if (!selAfter) selAfter = computeSelAfterChange(doc, change, null);
    if (doc.cm) makeChangeSingleDocInEditor(doc.cm, change, spans, selAfter);
    else updateDoc(doc, change, spans, selAfter);
  }

  function makeChangeSingleDocInEditor(cm, change, spans, selAfter) {
    var doc = cm.doc, display = cm.display, from = change.from, to = change.to;

    var recomputeMaxLength = false, checkWidthStart = from.line;
    if (!cm.options.lineWrapping) {
      checkWidthStart = lineNo(visualLine(doc, getLine(doc, from.line)));
      doc.iter(checkWidthStart, to.line + 1, function(line) {
        if (line == display.maxLine) {
          recomputeMaxLength = true;
          return true;
        }
      });
    }

    if (!posLess(doc.sel.head, change.from) && !posLess(change.to, doc.sel.head))
      cm.curOp.cursorActivity = true;

    updateDoc(doc, change, spans, selAfter, estimateHeight(cm));

    if (!cm.options.lineWrapping) {
      doc.iter(checkWidthStart, from.line + change.text.length, function(line) {
        var len = lineLength(doc, line);
        if (len > display.maxLineLength) {
          display.maxLine = line;
          display.maxLineLength = len;
          display.maxLineChanged = true;
          recomputeMaxLength = false;
        }
      });
      if (recomputeMaxLength) cm.curOp.updateMaxLine = true;
    }

    // Adjust frontier, schedule worker
    doc.frontier = Math.min(doc.frontier, from.line);
    startWorker(cm, 400);

    var lendiff = change.text.length - (to.line - from.line) - 1;
    // Remember that these lines changed, for updating the display
    regChange(cm, from.line, to.line + 1, lendiff);

    if (hasHandler(cm, "change")) {
      var changeObj = {from: from, to: to,
                       text: change.text,
                       removed: change.removed,
                       origin: change.origin};
      if (cm.curOp.textChanged) {
        for (var cur = cm.curOp.textChanged; cur.next; cur = cur.next) {}
        cur.next = changeObj;
      } else cm.curOp.textChanged = changeObj;
    }
  }

  function replaceRange(doc, code, from, to, origin) {
    if (!to) to = from;
    if (posLess(to, from)) { var tmp = to; to = from; from = tmp; }
    if (typeof code == "string") code = splitLines(code);
    makeChange(doc, {from: from, to: to, text: code, origin: origin}, null);
  }

  // POSITION OBJECT

  function Pos(line, ch) {
    if (!(this instanceof Pos)) return new Pos(line, ch);
    this.line = line; this.ch = ch;
  }
  CodeMirror.Pos = Pos;

  function posEq(a, b) {return a.line == b.line && a.ch == b.ch;}
  function posLess(a, b) {return a.line < b.line || (a.line == b.line && a.ch < b.ch);}
  function copyPos(x) {return Pos(x.line, x.ch);}

  // SELECTION

  function clipLine(doc, n) {return Math.max(doc.first, Math.min(n, doc.first + doc.size - 1));}
  function clipPos(doc, pos) {
    if (pos.line < doc.first) return Pos(doc.first, 0);
    var last = doc.first + doc.size - 1;
    if (pos.line > last) return Pos(last, getLine(doc, last).text.length);
    return clipToLen(pos, getLine(doc, pos.line).text.length);
  }
  function clipToLen(pos, linelen) {
    var ch = pos.ch;
    if (ch == null || ch > linelen) return Pos(pos.line, linelen);
    else if (ch < 0) return Pos(pos.line, 0);
    else return pos;
  }
  function isLine(doc, l) {return l >= doc.first && l < doc.first + doc.size;}

  // If shift is held, this will move the selection anchor. Otherwise,
  // it'll set the whole selection.
  function extendSelection(doc, pos, other, bias) {
    if (doc.sel.shift || doc.sel.extend) {
      var anchor = doc.sel.anchor;
      if (other) {
        var posBefore = posLess(pos, anchor);
        if (posBefore != posLess(other, anchor)) {
          anchor = pos;
          pos = other;
        } else if (posBefore != posLess(pos, other)) {
          pos = other;
        }
      }
      setSelection(doc, anchor, pos, bias);
    } else {
      setSelection(doc, pos, other || pos, bias);
    }
    if (doc.cm) doc.cm.curOp.userSelChange = true;
  }

  function filterSelectionChange(doc, anchor, head) {
    var obj = {anchor: anchor, head: head};
    signal(doc, "beforeSelectionChange", doc, obj);
    if (doc.cm) signal(doc.cm, "beforeSelectionChange", doc.cm, obj);
    obj.anchor = clipPos(doc, obj.anchor); obj.head = clipPos(doc, obj.head);
    return obj;
  }

  // Update the selection. Last two args are only used by
  // updateDoc, since they have to be expressed in the line
  // numbers before the update.
  function setSelection(doc, anchor, head, bias, checkAtomic) {
    if (!checkAtomic && hasHandler(doc, "beforeSelectionChange") || doc.cm && hasHandler(doc.cm, "beforeSelectionChange")) {
      var filtered = filterSelectionChange(doc, anchor, head);
      head = filtered.head;
      anchor = filtered.anchor;
    }

    var sel = doc.sel;
    sel.goalColumn = null;
    // Skip over atomic spans.
    if (checkAtomic || !posEq(anchor, sel.anchor))
      anchor = skipAtomic(doc, anchor, bias, checkAtomic != "push");
    if (checkAtomic || !posEq(head, sel.head))
      head = skipAtomic(doc, head, bias, checkAtomic != "push");

    if (posEq(sel.anchor, anchor) && posEq(sel.head, head)) return;

    sel.anchor = anchor; sel.head = head;
    var inv = posLess(head, anchor);
    sel.from = inv ? head : anchor;
    sel.to = inv ? anchor : head;

    if (doc.cm)
      doc.cm.curOp.updateInput = doc.cm.curOp.selectionChanged =
        doc.cm.curOp.cursorActivity = true;

    signalLater(doc, "cursorActivity", doc);
  }

  function reCheckSelection(cm) {
    setSelection(cm.doc, cm.doc.sel.from, cm.doc.sel.to, null, "push");
  }

  function skipAtomic(doc, pos, bias, mayClear) {
    var flipped = false, curPos = pos;
    var dir = bias || 1;
    doc.cantEdit = false;
    search: for (;;) {
      var line = getLine(doc, curPos.line);
      if (line.markedSpans) {
        for (var i = 0; i < line.markedSpans.length; ++i) {
          var sp = line.markedSpans[i], m = sp.marker;
          if ((sp.from == null || (m.inclusiveLeft ? sp.from <= curPos.ch : sp.from < curPos.ch)) &&
              (sp.to == null || (m.inclusiveRight ? sp.to >= curPos.ch : sp.to > curPos.ch))) {
            if (mayClear) {
              signal(m, "beforeCursorEnter");
              if (m.explicitlyCleared) {
                if (!line.markedSpans) break;
                else {--i; continue;}
              }
            }
            if (!m.atomic) continue;
            var newPos = m.find()[dir < 0 ? "from" : "to"];
            if (posEq(newPos, curPos)) {
              newPos.ch += dir;
              if (newPos.ch < 0) {
                if (newPos.line > doc.first) newPos = clipPos(doc, Pos(newPos.line - 1));
                else newPos = null;
              } else if (newPos.ch > line.text.length) {
                if (newPos.line < doc.first + doc.size - 1) newPos = Pos(newPos.line + 1, 0);
                else newPos = null;
              }
              if (!newPos) {
                if (flipped) {
                  // Driven in a corner -- no valid cursor position found at all
                  // -- try again *with* clearing, if we didn't already
                  if (!mayClear) return skipAtomic(doc, pos, bias, true);
                  // Otherwise, turn off editing until further notice, and return the start of the doc
                  doc.cantEdit = true;
                  return Pos(doc.first, 0);
                }
                flipped = true; newPos = pos; dir = -dir;
              }
            }
            curPos = newPos;
            continue search;
          }
        }
      }
      return curPos;
    }
  }

  // SCROLLING

  function scrollCursorIntoView(cm) {
    var coords = scrollPosIntoView(cm, cm.doc.sel.head);
    if (!cm.state.focused) return;
    var display = cm.display, box = getRect(display.sizer), doScroll = null, pTop = paddingTop(cm.display);
    if (coords.top + pTop + box.top < 0) doScroll = true;
    else if (coords.bottom + pTop + box.top > (window.innerHeight || document.documentElement.clientHeight)) doScroll = false;
    if (doScroll != null && !phantom) {
      var hidden = display.cursor.style.display == "none";
      if (hidden) {
        display.cursor.style.display = "";
        display.cursor.style.left = coords.left + "px";
        display.cursor.style.top = (coords.top - display.viewOffset) + "px";
      }
      display.cursor.scrollIntoView(doScroll);
      if (hidden) display.cursor.style.display = "none";
    }
  }

  function scrollPosIntoView(cm, pos, margin) {
    if (margin == null) margin = 0;
    for (;;) {
      var changed = false, coords = cursorCoords(cm, pos);
      var scrollPos = calculateScrollPos(cm, coords.left, coords.top - margin, coords.left, coords.bottom + margin);
      var startTop = cm.doc.scrollTop, startLeft = cm.doc.scrollLeft;
      if (scrollPos.scrollTop != null) {
        setScrollTop(cm, scrollPos.scrollTop);
        if (Math.abs(cm.doc.scrollTop - startTop) > 1) changed = true;
      }
      if (scrollPos.scrollLeft != null) {
        setScrollLeft(cm, scrollPos.scrollLeft);
        if (Math.abs(cm.doc.scrollLeft - startLeft) > 1) changed = true;
      }
      if (!changed) return coords;
    }
  }

  function scrollIntoView(cm, x1, y1, x2, y2) {
    var scrollPos = calculateScrollPos(cm, x1, y1, x2, y2);
    if (scrollPos.scrollTop != null) setScrollTop(cm, scrollPos.scrollTop);
    if (scrollPos.scrollLeft != null) setScrollLeft(cm, scrollPos.scrollLeft);
  }

  function calculateScrollPos(cm, x1, y1, x2, y2) {
    var display = cm.display, pt = paddingTop(display);
    y1 += pt; y2 += pt;
    if (y1 < 0) y1 = 0;
    var screen = display.scroller.clientHeight - scrollerCutOff, screentop = display.scroller.scrollTop, result = {};
    var docBottom = cm.doc.height + paddingVert(display);
    var atTop = y1 < pt + 10, atBottom = y2 + pt > docBottom - 10;
    if (y1 < screentop) {
      result.scrollTop = atTop ? 0 : y1;
    } else if (y2 > screentop + screen) {
      var newTop = Math.min(y1, (atBottom ? docBottom : y2) - screen);
      if (newTop != screentop) result.scrollTop = newTop;
    }

    var screenw = display.scroller.clientWidth - scrollerCutOff, screenleft = display.scroller.scrollLeft;
    x1 += display.gutters.offsetWidth; x2 += display.gutters.offsetWidth;
    var gutterw = display.gutters.offsetWidth;
    var atLeft = x1 < gutterw + 10;
    if (x1 < screenleft + gutterw || atLeft) {
      if (atLeft) x1 = 0;
      result.scrollLeft = Math.max(0, x1 - 10 - gutterw);
    } else if (x2 > screenw + screenleft - 3) {
      result.scrollLeft = x2 + 10 - screenw;
    }
    return result;
  }

  function updateScrollPos(cm, left, top) {
    cm.curOp.updateScrollPos = {scrollLeft: left == null ? cm.doc.scrollLeft : left,
                                scrollTop: top == null ? cm.doc.scrollTop : top};
  }

  function addToScrollPos(cm, left, top) {
    var pos = cm.curOp.updateScrollPos || (cm.curOp.updateScrollPos = {scrollLeft: cm.doc.scrollLeft, scrollTop: cm.doc.scrollTop});
    var scroll = cm.display.scroller;
    pos.scrollTop = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, pos.scrollTop + top));
    pos.scrollLeft = Math.max(0, Math.min(scroll.scrollWidth - scroll.clientWidth, pos.scrollLeft + left));
  }

  // API UTILITIES

  function indentLine(cm, n, how, aggressive) {
    var doc = cm.doc;
    if (!how) how = "add";
    if (how == "smart") {
      if (!cm.doc.mode.indent) how = "prev";
      else var state = getStateBefore(cm, n);
    }

    var tabSize = cm.options.tabSize;
    var line = getLine(doc, n), curSpace = countColumn(line.text, null, tabSize);
    var curSpaceString = line.text.match(/^\s*/)[0], indentation;
    if (how == "smart") {
      indentation = cm.doc.mode.indent(state, line.text.slice(curSpaceString.length), line.text);
      if (indentation == Pass) {
        if (!aggressive) return;
        how = "prev";
      }
    }
    if (how == "prev") {
      if (n > doc.first) indentation = countColumn(getLine(doc, n-1).text, null, tabSize);
      else indentation = 0;
    } else if (how == "add") {
      indentation = curSpace + cm.options.indentUnit;
    } else if (how == "subtract") {
      indentation = curSpace - cm.options.indentUnit;
    }
    indentation = Math.max(0, indentation);

    var indentString = "", pos = 0;
    if (cm.options.indentWithTabs)
      for (var i = Math.floor(indentation / tabSize); i; --i) {pos += tabSize; indentString += "\t";}
    if (pos < indentation) indentString += spaceStr(indentation - pos);

    if (indentString != curSpaceString)
      replaceRange(cm.doc, indentString, Pos(n, 0), Pos(n, curSpaceString.length), "+input");
    line.stateAfter = null;
  }

  function changeLine(cm, handle, op) {
    var no = handle, line = handle, doc = cm.doc;
    if (typeof handle == "number") line = getLine(doc, clipLine(doc, handle));
    else no = lineNo(handle);
    if (no == null) return null;
    if (op(line, no)) regChange(cm, no, no + 1);
    else return null;
    return line;
  }

  function findPosH(doc, pos, dir, unit, visually) {
    var line = pos.line, ch = pos.ch;
    var lineObj = getLine(doc, line);
    var possible = true;
    function findNextLine() {
      var l = line + dir;
      if (l < doc.first || l >= doc.first + doc.size) return (possible = false);
      line = l;
      return lineObj = getLine(doc, l);
    }
    function moveOnce(boundToLine) {
      var next = (visually ? moveVisually : moveLogically)(lineObj, ch, dir, true);
      if (next == null) {
        if (!boundToLine && findNextLine()) {
          if (visually) ch = (dir < 0 ? lineRight : lineLeft)(lineObj);
          else ch = dir < 0 ? lineObj.text.length : 0;
        } else return (possible = false);
      } else ch = next;
      return true;
    }

    if (unit == "char") moveOnce();
    else if (unit == "column") moveOnce(true);
    else if (unit == "word" || unit == "group") {
      var sawType = null, group = unit == "group";
      for (var first = true;; first = false) {
        if (dir < 0 && !moveOnce(!first)) break;
        var cur = lineObj.text.charAt(ch) || "\n";
        var type = isWordChar(cur) ? "w"
          : !group ? null
          : /\s/.test(cur) ? null
          : "p";
        if (sawType && sawType != type) {
          if (dir < 0) {dir = 1; moveOnce();}
          break;
        }
        if (type) sawType = type;
        if (dir > 0 && !moveOnce(!first)) break;
      }
    }
    var result = skipAtomic(doc, Pos(line, ch), dir, true);
    if (!possible) result.hitSide = true;
    return result;
  }

  function findPosV(cm, pos, dir, unit) {
    var doc = cm.doc, x = pos.left, y;
    if (unit == "page") {
      var pageSize = Math.min(cm.display.wrapper.clientHeight, window.innerHeight || document.documentElement.clientHeight);
      y = pos.top + dir * (pageSize - (dir < 0 ? 1.5 : .5) * textHeight(cm.display));
    } else if (unit == "line") {
      y = dir > 0 ? pos.bottom + 3 : pos.top - 3;
    }
    for (;;) {
      var target = coordsChar(cm, x, y);
      if (!target.outside) break;
      if (dir < 0 ? y <= 0 : y >= doc.height) { target.hitSide = true; break; }
      y += dir * 5;
    }
    return target;
  }

  function findWordAt(line, pos) {
    var start = pos.ch, end = pos.ch;
    if (line) {
      if (pos.after === false || end == line.length) --start; else ++end;
      var startChar = line.charAt(start);
      var check = isWordChar(startChar) ? isWordChar
        : /\s/.test(startChar) ? function(ch) {return /\s/.test(ch);}
        : function(ch) {return !/\s/.test(ch) && !isWordChar(ch);};
      while (start > 0 && check(line.charAt(start - 1))) --start;
      while (end < line.length && check(line.charAt(end))) ++end;
    }
    return {from: Pos(pos.line, start), to: Pos(pos.line, end)};
  }

  function selectLine(cm, line) {
    extendSelection(cm.doc, Pos(line, 0), clipPos(cm.doc, Pos(line + 1, 0)));
  }

  // PROTOTYPE

  // The publicly visible API. Note that operation(null, f) means
  // 'wrap f in an operation, performed on its `this` parameter'

  CodeMirror.prototype = {
    focus: function(){window.focus(); focusInput(this); onFocus(this); fastPoll(this);},

    setOption: function(option, value) {
      var options = this.options, old = options[option];
      if (options[option] == value && option != "mode") return;
      options[option] = value;
      if (optionHandlers.hasOwnProperty(option))
        operation(this, optionHandlers[option])(this, value, old);
    },

    getOption: function(option) {return this.options[option];},
    getDoc: function() {return this.doc;},

    addKeyMap: function(map, bottom) {
      this.state.keyMaps[bottom ? "push" : "unshift"](map);
    },
    removeKeyMap: function(map) {
      var maps = this.state.keyMaps;
      for (var i = 0; i < maps.length; ++i)
        if ((typeof map == "string" ? maps[i].name : maps[i]) == map) {
          maps.splice(i, 1);
          return true;
        }
    },

    addOverlay: operation(null, function(spec, options) {
      var mode = spec.token ? spec : CodeMirror.getMode(this.options, spec);
      if (mode.startState) throw new Error("Overlays may not be stateful.");
      this.state.overlays.push({mode: mode, modeSpec: spec, opaque: options && options.opaque});
      this.state.modeGen++;
      regChange(this);
    }),
    removeOverlay: operation(null, function(spec) {
      var overlays = this.state.overlays;
      for (var i = 0; i < overlays.length; ++i) {
        if (overlays[i].modeSpec == spec) {
          overlays.splice(i, 1);
          this.state.modeGen++;
          regChange(this);
          return;
        }
      }
    }),

    indentLine: operation(null, function(n, dir, aggressive) {
      if (typeof dir != "string") {
        if (dir == null) dir = this.options.smartIndent ? "smart" : "prev";
        else dir = dir ? "add" : "subtract";
      }
      if (isLine(this.doc, n)) indentLine(this, n, dir, aggressive);
    }),
    indentSelection: operation(null, function(how) {
      var sel = this.doc.sel;
      if (posEq(sel.from, sel.to)) return indentLine(this, sel.from.line, how);
      var e = sel.to.line - (sel.to.ch ? 0 : 1);
      for (var i = sel.from.line; i <= e; ++i) indentLine(this, i, how);
    }),

    // Fetch the parser token for a given character. Useful for hacks
    // that want to inspect the mode state (say, for completion).
    getTokenAt: function(pos) {
      var doc = this.doc;
      pos = clipPos(doc, pos);
      var state = getStateBefore(this, pos.line), mode = this.doc.mode;
      var line = getLine(doc, pos.line);
      var stream = new StringStream(line.text, this.options.tabSize);
      while (stream.pos < pos.ch && !stream.eol()) {
        stream.start = stream.pos;
        var style = mode.token(stream, state);
      }
      return {start: stream.start,
              end: stream.pos,
              string: stream.current(),
              className: style || null, // Deprecated, use 'type' instead
              type: style || null,
              state: state};
    },

    getStateAfter: function(line) {
      var doc = this.doc;
      line = clipLine(doc, line == null ? doc.first + doc.size - 1: line);
      return getStateBefore(this, line + 1);
    },

    cursorCoords: function(start, mode) {
      var pos, sel = this.doc.sel;
      if (start == null) pos = sel.head;
      else if (typeof start == "object") pos = clipPos(this.doc, start);
      else pos = start ? sel.from : sel.to;
      return cursorCoords(this, pos, mode || "page");
    },

    charCoords: function(pos, mode) {
      return charCoords(this, clipPos(this.doc, pos), mode || "page");
    },

    coordsChar: function(coords, mode) {
      coords = fromCoordSystem(this, coords, mode || "page");
      return coordsChar(this, coords.left, coords.top);
    },

    defaultTextHeight: function() { return textHeight(this.display); },
    defaultCharWidth: function() { return charWidth(this.display); },

    setGutterMarker: operation(null, function(line, gutterID, value) {
      return changeLine(this, line, function(line) {
        var markers = line.gutterMarkers || (line.gutterMarkers = {});
        markers[gutterID] = value;
        if (!value && isEmpty(markers)) line.gutterMarkers = null;
        return true;
      });
    }),

    clearGutter: operation(null, function(gutterID) {
      var cm = this, doc = cm.doc, i = doc.first;
      doc.iter(function(line) {
        if (line.gutterMarkers && line.gutterMarkers[gutterID]) {
          line.gutterMarkers[gutterID] = null;
          regChange(cm, i, i + 1);
          if (isEmpty(line.gutterMarkers)) line.gutterMarkers = null;
        }
        ++i;
      });
    }),

    addLineClass: operation(null, function(handle, where, cls) {
      return changeLine(this, handle, function(line) {
        var prop = where == "text" ? "textClass" : where == "background" ? "bgClass" : "wrapClass";
        if (!line[prop]) line[prop] = cls;
        else if (new RegExp("\\b" + cls + "\\b").test(line[prop])) return false;
        else line[prop] += " " + cls;
        return true;
      });
    }),

    removeLineClass: operation(null, function(handle, where, cls) {
      return changeLine(this, handle, function(line) {
        var prop = where == "text" ? "textClass" : where == "background" ? "bgClass" : "wrapClass";
        var cur = line[prop];
        if (!cur) return false;
        else if (cls == null) line[prop] = null;
        else {
          var upd = cur.replace(new RegExp("^" + cls + "\\b\\s*|\\s*\\b" + cls + "\\b"), "");
          if (upd == cur) return false;
          line[prop] = upd || null;
        }
        return true;
      });
    }),

    addLineWidget: operation(null, function(handle, node, options) {
      return addLineWidget(this, handle, node, options);
    }),

    removeLineWidget: function(widget) { widget.clear(); },

    lineInfo: function(line) {
      if (typeof line == "number") {
        if (!isLine(this.doc, line)) return null;
        var n = line;
        line = getLine(this.doc, line);
        if (!line) return null;
      } else {
        var n = lineNo(line);
        if (n == null) return null;
      }
      return {line: n, handle: line, text: line.text, gutterMarkers: line.gutterMarkers,
              textClass: line.textClass, bgClass: line.bgClass, wrapClass: line.wrapClass,
              widgets: line.widgets};
    },

    getViewport: function() { return {from: this.display.showingFrom, to: this.display.showingTo};},

    addWidget: function(pos, node, scroll, vert, horiz) {
      var display = this.display;
      pos = cursorCoords(this, clipPos(this.doc, pos));
      var top = pos.bottom, left = pos.left;
      node.style.position = "absolute";
      display.sizer.appendChild(node);
      if (vert == "over") {
        top = pos.top;
      } else if (vert == "above" || vert == "near") {
        var vspace = Math.max(display.wrapper.clientHeight, this.doc.height),
        hspace = Math.max(display.sizer.clientWidth, display.lineSpace.clientWidth);
        // Default to positioning above (if specified and possible); otherwise default to positioning below
        if ((vert == 'above' || pos.bottom + node.offsetHeight > vspace) && pos.top > node.offsetHeight)
          top = pos.top - node.offsetHeight;
        else if (pos.bottom + node.offsetHeight <= vspace)
          top = pos.bottom;
        if (left + node.offsetWidth > hspace)
          left = hspace - node.offsetWidth;
      }
      node.style.top = (top + paddingTop(display)) + "px";
      node.style.left = node.style.right = "";
      if (horiz == "right") {
        left = display.sizer.clientWidth - node.offsetWidth;
        node.style.right = "0px";
      } else {
        if (horiz == "left") left = 0;
        else if (horiz == "middle") left = (display.sizer.clientWidth - node.offsetWidth) / 2;
        node.style.left = left + "px";
      }
      if (scroll)
        scrollIntoView(this, left, top, left + node.offsetWidth, top + node.offsetHeight);
    },

    triggerOnKeyDown: operation(null, onKeyDown),

    execCommand: function(cmd) {return commands[cmd](this);},

    findPosH: function(from, amount, unit, visually) {
      var dir = 1;
      if (amount < 0) { dir = -1; amount = -amount; }
      for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
        cur = findPosH(this.doc, cur, dir, unit, visually);
        if (cur.hitSide) break;
      }
      return cur;
    },

    moveH: operation(null, function(dir, unit) {
      var sel = this.doc.sel, pos;
      if (sel.shift || sel.extend || posEq(sel.from, sel.to))
        pos = findPosH(this.doc, sel.head, dir, unit, this.options.rtlMoveVisually);
      else
        pos = dir < 0 ? sel.from : sel.to;
      extendSelection(this.doc, pos, pos, dir);
    }),

    deleteH: operation(null, function(dir, unit) {
      var sel = this.doc.sel;
      if (!posEq(sel.from, sel.to)) replaceRange(this.doc, "", sel.from, sel.to, "+delete");
      else replaceRange(this.doc, "", sel.from, findPosH(this.doc, sel.head, dir, unit, false), "+delete");
      this.curOp.userSelChange = true;
    }),

    findPosV: function(from, amount, unit, goalColumn) {
      var dir = 1, x = goalColumn;
      if (amount < 0) { dir = -1; amount = -amount; }
      for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
        var coords = cursorCoords(this, cur, "div");
        if (x == null) x = coords.left;
        else coords.left = x;
        cur = findPosV(this, coords, dir, unit);
        if (cur.hitSide) break;
      }
      return cur;
    },

    moveV: operation(null, function(dir, unit) {
      var sel = this.doc.sel;
      var pos = cursorCoords(this, sel.head, "div");
      if (sel.goalColumn != null) pos.left = sel.goalColumn;
      var target = findPosV(this, pos, dir, unit);

      if (unit == "page") addToScrollPos(this, 0, charCoords(this, target, "div").top - pos.top);
      extendSelection(this.doc, target, target, dir);
      sel.goalColumn = pos.left;
    }),

    toggleOverwrite: function() {
      if (this.state.overwrite = !this.state.overwrite)
        this.display.cursor.className += " CodeMirror-overwrite";
      else
        this.display.cursor.className = this.display.cursor.className.replace(" CodeMirror-overwrite", "");
    },
    hasFocus: function() { return this.state.focused; },

    scrollTo: operation(null, function(x, y) {
      updateScrollPos(this, x, y);
    }),
    getScrollInfo: function() {
      var scroller = this.display.scroller, co = scrollerCutOff;
      return {left: scroller.scrollLeft, top: scroller.scrollTop,
              height: scroller.scrollHeight - co, width: scroller.scrollWidth - co,
              clientHeight: scroller.clientHeight - co, clientWidth: scroller.clientWidth - co};
    },

    scrollIntoView: operation(null, function(pos, margin) {
      if (typeof pos == "number") pos = Pos(pos, 0);
      if (!margin) margin = 0;
      var coords = pos;

      if (!pos || pos.line != null) {
        this.curOp.scrollToPos = pos ? clipPos(this.doc, pos) : this.doc.sel.head;
        this.curOp.scrollToPosMargin = margin;
        coords = cursorCoords(this, this.curOp.scrollToPos);
      }
      var sPos = calculateScrollPos(this, coords.left, coords.top - margin, coords.right, coords.bottom + margin);
      updateScrollPos(this, sPos.scrollLeft, sPos.scrollTop);
    }),

    setSize: function(width, height) {
      function interpret(val) {
        return typeof val == "number" || /^\d+$/.test(String(val)) ? val + "px" : val;
      }
      if (width != null) this.display.wrapper.style.width = interpret(width);
      if (height != null) this.display.wrapper.style.height = interpret(height);
      this.refresh();
    },

    on: function(type, f) {on(this, type, f);},
    off: function(type, f) {off(this, type, f);},

    operation: function(f){return runInOp(this, f);},

    refresh: operation(null, function() {
      clearCaches(this);
      updateScrollPos(this, this.doc.scrollLeft, this.doc.scrollTop);
      regChange(this);
    }),

    swapDoc: operation(null, function(doc) {
      var old = this.doc;
      old.cm = null;
      attachDoc(this, doc);
      clearCaches(this);
      resetInput(this, true);
      updateScrollPos(this, doc.scrollLeft, doc.scrollTop);
      return old;
    }),

    getInputField: function(){return this.display.input;},
    getWrapperElement: function(){return this.display.wrapper;},
    getScrollerElement: function(){return this.display.scroller;},
    getGutterElement: function(){return this.display.gutters;}
  };

  // OPTION DEFAULTS

  var optionHandlers = CodeMirror.optionHandlers = {};

  // The default configuration options.
  var defaults = CodeMirror.defaults = {};

  function option(name, deflt, handle, notOnInit) {
    CodeMirror.defaults[name] = deflt;
    if (handle) optionHandlers[name] =
      notOnInit ? function(cm, val, old) {if (old != Init) handle(cm, val, old);} : handle;
  }

  var Init = CodeMirror.Init = {toString: function(){return "CodeMirror.Init";}};

  // These two are, on init, called from the constructor because they
  // have to be initialized before the editor can start at all.
  option("value", "", function(cm, val) {
    cm.setValue(val);
  }, true);
  option("mode", null, function(cm, val) {
    cm.doc.modeOption = val;
    loadMode(cm);
  }, true);

  option("indentUnit", 2, loadMode, true);
  option("indentWithTabs", false);
  option("smartIndent", true);
  option("tabSize", 4, function(cm) {
    loadMode(cm);
    clearCaches(cm);
    regChange(cm);
  }, true);
  option("electricChars", true);
  option("rtlMoveVisually", !windows);

  option("theme", "default", function(cm) {
    themeChanged(cm);
    guttersChanged(cm);
  }, true);
  option("keyMap", "default", keyMapChanged);
  option("extraKeys", null);

  option("onKeyEvent", null);
  option("onDragEvent", null);

  option("lineWrapping", false, wrappingChanged, true);
  option("gutters", [], function(cm) {
    setGuttersForLineNumbers(cm.options);
    guttersChanged(cm);
  }, true);
  option("fixedGutter", true, function(cm, val) {
    cm.display.gutters.style.left = val ? compensateForHScroll(cm.display) + "px" : "0";
    cm.refresh();
  }, true);
  option("lineNumbers", false, function(cm) {
    setGuttersForLineNumbers(cm.options);
    guttersChanged(cm);
  }, true);
  option("firstLineNumber", 1, guttersChanged, true);
  option("lineNumberFormatter", function(integer) {return integer;}, guttersChanged, true);
  option("showCursorWhenSelecting", false, updateSelection, true);

  option("readOnly", false, function(cm, val) {
    if (val == "nocursor") {onBlur(cm); cm.display.input.blur();}
    else if (!val) resetInput(cm, true);
  });
  option("dragDrop", true);

  option("cursorBlinkRate", 530);
  option("cursorHeight", 1);
  option("workTime", 100);
  option("workDelay", 100);
  option("flattenSpans", true);
  option("pollInterval", 100);
  option("undoDepth", 40, function(cm, val){cm.doc.history.undoDepth = val;});
  option("historyEventDelay", 500);
  option("viewportMargin", 10, function(cm){cm.refresh();}, true);
  option("maxHighlightLength", 10000, function(cm){loadMode(cm); cm.refresh();}, true);
  option("moveInputWithCursor", true, function(cm, val) {
    if (!val) cm.display.inputDiv.style.top = cm.display.inputDiv.style.left = 0;
  });

  option("tabindex", null, function(cm, val) {
    cm.display.input.tabIndex = val || "";
  });
  option("autofocus", null);

  // MODE DEFINITION AND QUERYING

  // Known modes, by name and by MIME
  var modes = CodeMirror.modes = {}, mimeModes = CodeMirror.mimeModes = {};

  CodeMirror.defineMode = function(name, mode) {
    if (!CodeMirror.defaults.mode && name != "null") CodeMirror.defaults.mode = name;
    if (arguments.length > 2) {
      mode.dependencies = [];
      for (var i = 2; i < arguments.length; ++i) mode.dependencies.push(arguments[i]);
    }
    modes[name] = mode;
  };

  CodeMirror.defineMIME = function(mime, spec) {
    mimeModes[mime] = spec;
  };

  CodeMirror.resolveMode = function(spec) {
    if (typeof spec == "string" && mimeModes.hasOwnProperty(spec))
      spec = mimeModes[spec];
    else if (typeof spec == "string" && /^[\w\-]+\/[\w\-]+\+xml$/.test(spec))
      return CodeMirror.resolveMode("application/xml");
    if (typeof spec == "string") return {name: spec};
    else return spec || {name: "null"};
  };

  CodeMirror.getMode = function(options, spec) {
    spec = CodeMirror.resolveMode(spec);
    var mfactory = modes[spec.name];
    if (!mfactory) return CodeMirror.getMode(options, "text/plain");
    var modeObj = mfactory(options, spec);
    if (modeExtensions.hasOwnProperty(spec.name)) {
      var exts = modeExtensions[spec.name];
      for (var prop in exts) {
        if (!exts.hasOwnProperty(prop)) continue;
        if (modeObj.hasOwnProperty(prop)) modeObj["_" + prop] = modeObj[prop];
        modeObj[prop] = exts[prop];
      }
    }
    modeObj.name = spec.name;
    return modeObj;
  };

  CodeMirror.defineMode("null", function() {
    return {token: function(stream) {stream.skipToEnd();}};
  });
  CodeMirror.defineMIME("text/plain", "null");

  var modeExtensions = CodeMirror.modeExtensions = {};
  CodeMirror.extendMode = function(mode, properties) {
    var exts = modeExtensions.hasOwnProperty(mode) ? modeExtensions[mode] : (modeExtensions[mode] = {});
    copyObj(properties, exts);
  };

  // EXTENSIONS

  CodeMirror.defineExtension = function(name, func) {
    CodeMirror.prototype[name] = func;
  };
  CodeMirror.defineDocExtension = function(name, func) {
    Doc.prototype[name] = func;
  };
  CodeMirror.defineOption = option;

  var initHooks = [];
  CodeMirror.defineInitHook = function(f) {initHooks.push(f);};

  // MODE STATE HANDLING

  // Utility functions for working with state. Exported because modes
  // sometimes need to do this.
  function copyState(mode, state) {
    if (state === true) return state;
    if (mode.copyState) return mode.copyState(state);
    var nstate = {};
    for (var n in state) {
      var val = state[n];
      if (val instanceof Array) val = val.concat([]);
      nstate[n] = val;
    }
    return nstate;
  }
  CodeMirror.copyState = copyState;

  function startState(mode, a1, a2) {
    return mode.startState ? mode.startState(a1, a2) : true;
  }
  CodeMirror.startState = startState;

  CodeMirror.innerMode = function(mode, state) {
    while (mode.innerMode) {
      var info = mode.innerMode(state);
      state = info.state;
      mode = info.mode;
    }
    return info || {mode: mode, state: state};
  };

  // STANDARD COMMANDS

  var commands = CodeMirror.commands = {
    selectAll: function(cm) {cm.setSelection(Pos(cm.firstLine(), 0), Pos(cm.lastLine()));},
    killLine: function(cm) {
      var from = cm.getCursor(true), to = cm.getCursor(false), sel = !posEq(from, to);
      if (!sel && cm.getLine(from.line).length == from.ch)
        cm.replaceRange("", from, Pos(from.line + 1, 0), "+delete");
      else cm.replaceRange("", from, sel ? to : Pos(from.line), "+delete");
    },
    deleteLine: function(cm) {
      var l = cm.getCursor().line;
      cm.replaceRange("", Pos(l, 0), Pos(l), "+delete");
    },
    undo: function(cm) {cm.undo();},
    redo: function(cm) {cm.redo();},
    goDocStart: function(cm) {cm.extendSelection(Pos(cm.firstLine(), 0));},
    goDocEnd: function(cm) {cm.extendSelection(Pos(cm.lastLine()));},
    goLineStart: function(cm) {
      cm.extendSelection(lineStart(cm, cm.getCursor().line));
    },
    goLineStartSmart: function(cm) {
      var cur = cm.getCursor(), start = lineStart(cm, cur.line);
      var line = cm.getLineHandle(start.line);
      var order = getOrder(line);
      if (!order || order[0].level == 0) {
        var firstNonWS = Math.max(0, line.text.search(/\S/));
        var inWS = cur.line == start.line && cur.ch <= firstNonWS && cur.ch;
        cm.extendSelection(Pos(start.line, inWS ? 0 : firstNonWS));
      } else cm.extendSelection(start);
    },
    goLineEnd: function(cm) {
      cm.extendSelection(lineEnd(cm, cm.getCursor().line));
    },
    goLineRight: function(cm) {
      var top = cm.charCoords(cm.getCursor(), "div").top + 5;
      cm.extendSelection(cm.coordsChar({left: cm.display.lineDiv.offsetWidth + 100, top: top}, "div"));
    },
    goLineLeft: function(cm) {
      var top = cm.charCoords(cm.getCursor(), "div").top + 5;
      cm.extendSelection(cm.coordsChar({left: 0, top: top}, "div"));
    },
    goLineUp: function(cm) {cm.moveV(-1, "line");},
    goLineDown: function(cm) {cm.moveV(1, "line");},
    goPageUp: function(cm) {cm.moveV(-1, "page");},
    goPageDown: function(cm) {cm.moveV(1, "page");},
    goCharLeft: function(cm) {cm.moveH(-1, "char");},
    goCharRight: function(cm) {cm.moveH(1, "char");},
    goColumnLeft: function(cm) {cm.moveH(-1, "column");},
    goColumnRight: function(cm) {cm.moveH(1, "column");},
    goWordLeft: function(cm) {cm.moveH(-1, "word");},
    goGroupRight: function(cm) {cm.moveH(1, "group");},
    goGroupLeft: function(cm) {cm.moveH(-1, "group");},
    goWordRight: function(cm) {cm.moveH(1, "word");},
    delCharBefore: function(cm) {cm.deleteH(-1, "char");},
    delCharAfter: function(cm) {cm.deleteH(1, "char");},
    delWordBefore: function(cm) {cm.deleteH(-1, "word");},
    delWordAfter: function(cm) {cm.deleteH(1, "word");},
    delGroupBefore: function(cm) {cm.deleteH(-1, "group");},
    delGroupAfter: function(cm) {cm.deleteH(1, "group");},
    indentAuto: function(cm) {cm.indentSelection("smart");},
    indentMore: function(cm) {cm.indentSelection("add");},
    indentLess: function(cm) {cm.indentSelection("subtract");},
    insertTab: function(cm) {cm.replaceSelection("\t", "end", "+input");},
    defaultTab: function(cm) {
      if (cm.somethingSelected()) cm.indentSelection("add");
      else cm.replaceSelection("\t", "end", "+input");
    },
    transposeChars: function(cm) {
      var cur = cm.getCursor(), line = cm.getLine(cur.line);
      if (cur.ch > 0 && cur.ch < line.length - 1)
        cm.replaceRange(line.charAt(cur.ch) + line.charAt(cur.ch - 1),
                        Pos(cur.line, cur.ch - 1), Pos(cur.line, cur.ch + 1));
    },
    newlineAndIndent: function(cm) {
      operation(cm, function() {
        cm.replaceSelection("\n", "end", "+input");
        cm.indentLine(cm.getCursor().line, null, true);
      })();
    },
    toggleOverwrite: function(cm) {cm.toggleOverwrite();}
  };

  // STANDARD KEYMAPS

  var keyMap = CodeMirror.keyMap = {};
  keyMap.basic = {
    "Left": "goCharLeft", "Right": "goCharRight", "Up": "goLineUp", "Down": "goLineDown",
    "End": "goLineEnd", "Home": "goLineStartSmart", "PageUp": "goPageUp", "PageDown": "goPageDown",
    "Delete": "delCharAfter", "Backspace": "delCharBefore", "Tab": "defaultTab", "Shift-Tab": "indentAuto",
    "Enter": "newlineAndIndent", "Insert": "toggleOverwrite"
  };
  // Note that the save and find-related commands aren't defined by
  // default. Unknown commands are simply ignored.
  keyMap.pcDefault = {
    "Ctrl-A": "selectAll", "Ctrl-D": "deleteLine", "Ctrl-Z": "undo", "Shift-Ctrl-Z": "redo", "Ctrl-Y": "redo",
    "Ctrl-Home": "goDocStart", "Alt-Up": "goDocStart", "Ctrl-End": "goDocEnd", "Ctrl-Down": "goDocEnd",
    "Ctrl-Left": "goGroupLeft", "Ctrl-Right": "goGroupRight", "Alt-Left": "goLineStart", "Alt-Right": "goLineEnd",
    "Ctrl-Backspace": "delGroupBefore", "Ctrl-Delete": "delGroupAfter", "Ctrl-S": "save", "Ctrl-F": "find",
    "Ctrl-G": "findNext", "Shift-Ctrl-G": "findPrev", "Shift-Ctrl-F": "replace", "Shift-Ctrl-R": "replaceAll",
    "Ctrl-[": "indentLess", "Ctrl-]": "indentMore",
    fallthrough: "basic"
  };
  keyMap.macDefault = {
    "Cmd-A": "selectAll", "Cmd-D": "deleteLine", "Cmd-Z": "undo", "Shift-Cmd-Z": "redo", "Cmd-Y": "redo",
    "Cmd-Up": "goDocStart", "Cmd-End": "goDocEnd", "Cmd-Down": "goDocEnd", "Alt-Left": "goGroupLeft",
    "Alt-Right": "goGroupRight", "Cmd-Left": "goLineStart", "Cmd-Right": "goLineEnd", "Alt-Backspace": "delGroupBefore",
    "Ctrl-Alt-Backspace": "delGroupAfter", "Alt-Delete": "delGroupAfter", "Cmd-S": "save", "Cmd-F": "find",
    "Cmd-G": "findNext", "Shift-Cmd-G": "findPrev", "Cmd-Alt-F": "replace", "Shift-Cmd-Alt-F": "replaceAll",
    "Cmd-[": "indentLess", "Cmd-]": "indentMore",
    fallthrough: ["basic", "emacsy"]
  };
  keyMap["default"] = mac ? keyMap.macDefault : keyMap.pcDefault;
  keyMap.emacsy = {
    "Ctrl-F": "goCharRight", "Ctrl-B": "goCharLeft", "Ctrl-P": "goLineUp", "Ctrl-N": "goLineDown",
    "Alt-F": "goWordRight", "Alt-B": "goWordLeft", "Ctrl-A": "goLineStart", "Ctrl-E": "goLineEnd",
    "Ctrl-V": "goPageDown", "Shift-Ctrl-V": "goPageUp", "Ctrl-D": "delCharAfter", "Ctrl-H": "delCharBefore",
    "Alt-D": "delWordAfter", "Alt-Backspace": "delWordBefore", "Ctrl-K": "killLine", "Ctrl-T": "transposeChars"
  };

  // KEYMAP DISPATCH

  function getKeyMap(val) {
    if (typeof val == "string") return keyMap[val];
    else return val;
  }

  function lookupKey(name, maps, handle) {
    function lookup(map) {
      map = getKeyMap(map);
      var found = map[name];
      if (found === false) return "stop";
      if (found != null && handle(found)) return true;
      if (map.nofallthrough) return "stop";

      var fallthrough = map.fallthrough;
      if (fallthrough == null) return false;
      if (Object.prototype.toString.call(fallthrough) != "[object Array]")
        return lookup(fallthrough);
      for (var i = 0, e = fallthrough.length; i < e; ++i) {
        var done = lookup(fallthrough[i]);
        if (done) return done;
      }
      return false;
    }

    for (var i = 0; i < maps.length; ++i) {
      var done = lookup(maps[i]);
      if (done) return done;
    }
  }
  function isModifierKey(event) {
    var name = keyNames[event.keyCode];
    return name == "Ctrl" || name == "Alt" || name == "Shift" || name == "Mod";
  }
  function keyName(event, noShift) {
    if (opera && event.keyCode == 34 && event["char"]) return false;
    var name = keyNames[event.keyCode];
    if (name == null || event.altGraphKey) return false;
    if (event.altKey) name = "Alt-" + name;
    if (flipCtrlCmd ? event.metaKey : event.ctrlKey) name = "Ctrl-" + name;
    if (flipCtrlCmd ? event.ctrlKey : event.metaKey) name = "Cmd-" + name;
    if (!noShift && event.shiftKey) name = "Shift-" + name;
    return name;
  }
  CodeMirror.lookupKey = lookupKey;
  CodeMirror.isModifierKey = isModifierKey;
  CodeMirror.keyName = keyName;

  // FROMTEXTAREA

  CodeMirror.fromTextArea = function(textarea, options) {
    if (!options) options = {};
    options.value = textarea.value;
    if (!options.tabindex && textarea.tabindex)
      options.tabindex = textarea.tabindex;
    if (!options.placeholder && textarea.placeholder)
      options.placeholder = textarea.placeholder;
    // Set autofocus to true if this textarea is focused, or if it has
    // autofocus and no other element is focused.
    if (options.autofocus == null) {
      var hasFocus = document.body;
      // doc.activeElement occasionally throws on IE
      try { hasFocus = document.activeElement; } catch(e) {}
      options.autofocus = hasFocus == textarea ||
        textarea.getAttribute("autofocus") != null && hasFocus == document.body;
    }

    function save() {textarea.value = cm.getValue();}
    if (textarea.form) {
      on(textarea.form, "submit", save);
      // Deplorable hack to make the submit method do the right thing.
      if (!options.leaveSubmitMethodAlone) {
        var form = textarea.form, realSubmit = form.submit;
        try {
          var wrappedSubmit = form.submit = function() {
            save();
            form.submit = realSubmit;
            form.submit();
            form.submit = wrappedSubmit;
          };
        } catch(e) {}
      }
    }

    textarea.style.display = "none";
    var cm = CodeMirror(function(node) {
      textarea.parentNode.insertBefore(node, textarea.nextSibling);
    }, options);
    cm.save = save;
    cm.getTextArea = function() { return textarea; };
    cm.toTextArea = function() {
      save();
      textarea.parentNode.removeChild(cm.getWrapperElement());
      textarea.style.display = "";
      if (textarea.form) {
        off(textarea.form, "submit", save);
        if (typeof textarea.form.submit == "function")
          textarea.form.submit = realSubmit;
      }
    };
    return cm;
  };

  // STRING STREAM

  // Fed to the mode parsers, provides helper functions to make
  // parsers more succinct.

  // The character stream used by a mode's parser.
  function StringStream(string, tabSize) {
    this.pos = this.start = 0;
    this.string = string;
    this.tabSize = tabSize || 8;
    this.lastColumnPos = this.lastColumnValue = 0;
  }

  StringStream.prototype = {
    eol: function() {return this.pos >= this.string.length;},
    sol: function() {return this.pos == 0;},
    peek: function() {return this.string.charAt(this.pos) || undefined;},
    next: function() {
      if (this.pos < this.string.length)
        return this.string.charAt(this.pos++);
    },
    eat: function(match) {
      var ch = this.string.charAt(this.pos);
      if (typeof match == "string") var ok = ch == match;
      else var ok = ch && (match.test ? match.test(ch) : match(ch));
      if (ok) {++this.pos; return ch;}
    },
    eatWhile: function(match) {
      var start = this.pos;
      while (this.eat(match)){}
      return this.pos > start;
    },
    eatSpace: function() {
      var start = this.pos;
      while (/[\s\u00a0]/.test(this.string.charAt(this.pos))) ++this.pos;
      return this.pos > start;
    },
    skipToEnd: function() {this.pos = this.string.length;},
    skipTo: function(ch) {
      var found = this.string.indexOf(ch, this.pos);
      if (found > -1) {this.pos = found; return true;}
    },
    backUp: function(n) {this.pos -= n;},
    column: function() {
      if (this.lastColumnPos < this.start) {
        this.lastColumnValue = countColumn(this.string, this.start, this.tabSize, this.lastColumnPos, this.lastColumnValue);
        this.lastColumnPos = this.start;
      }
      return this.lastColumnValue;
    },
    indentation: function() {return countColumn(this.string, null, this.tabSize);},
    match: function(pattern, consume, caseInsensitive) {
      if (typeof pattern == "string") {
        var cased = function(str) {return caseInsensitive ? str.toLowerCase() : str;};
        var substr = this.string.substr(this.pos, pattern.length);
        if (cased(substr) == cased(pattern)) {
          if (consume !== false) this.pos += pattern.length;
          return true;
        }
      } else {
        var match = this.string.slice(this.pos).match(pattern);
        if (match && match.index > 0) return null;
        if (match && consume !== false) this.pos += match[0].length;
        return match;
      }
    },
    current: function(){return this.string.slice(this.start, this.pos);}
  };
  CodeMirror.StringStream = StringStream;

  // TEXTMARKERS

  function TextMarker(doc, type) {
    this.lines = [];
    this.type = type;
    this.doc = doc;
  }
  CodeMirror.TextMarker = TextMarker;

  TextMarker.prototype.clear = function() {
    if (this.explicitlyCleared) return;
    var cm = this.doc.cm, withOp = cm && !cm.curOp;
    if (withOp) startOperation(cm);
    var min = null, max = null;
    for (var i = 0; i < this.lines.length; ++i) {
      var line = this.lines[i];
      var span = getMarkedSpanFor(line.markedSpans, this);
      if (span.to != null) max = lineNo(line);
      line.markedSpans = removeMarkedSpan(line.markedSpans, span);
      if (span.from != null)
        min = lineNo(line);
      else if (this.collapsed && !lineIsHidden(this.doc, line) && cm)
        updateLineHeight(line, textHeight(cm.display));
    }
    if (cm && this.collapsed && !cm.options.lineWrapping) for (var i = 0; i < this.lines.length; ++i) {
      var visual = visualLine(cm.doc, this.lines[i]), len = lineLength(cm.doc, visual);
      if (len > cm.display.maxLineLength) {
        cm.display.maxLine = visual;
        cm.display.maxLineLength = len;
        cm.display.maxLineChanged = true;
      }
    }

    if (min != null && cm) regChange(cm, min, max + 1);
    this.lines.length = 0;
    this.explicitlyCleared = true;
    if (this.collapsed && this.doc.cantEdit) {
      this.doc.cantEdit = false;
      if (cm) reCheckSelection(cm);
    }
    if (withOp) endOperation(cm);
    signalLater(this, "clear");
  };

  TextMarker.prototype.find = function() {
    var from, to;
    for (var i = 0; i < this.lines.length; ++i) {
      var line = this.lines[i];
      var span = getMarkedSpanFor(line.markedSpans, this);
      if (span.from != null || span.to != null) {
        var found = lineNo(line);
        if (span.from != null) from = Pos(found, span.from);
        if (span.to != null) to = Pos(found, span.to);
      }
    }
    if (this.type == "bookmark") return from;
    return from && {from: from, to: to};
  };

  TextMarker.prototype.getOptions = function(copyWidget) {
    var repl = this.replacedWith;
    return {className: this.className,
            inclusiveLeft: this.inclusiveLeft, inclusiveRight: this.inclusiveRight,
            atomic: this.atomic,
            collapsed: this.collapsed,
            replacedWith: copyWidget ? repl && repl.cloneNode(true) : repl,
            readOnly: this.readOnly,
            startStyle: this.startStyle, endStyle: this.endStyle};
  };

  TextMarker.prototype.attachLine = function(line) {
    if (!this.lines.length && this.doc.cm) {
      var op = this.doc.cm.curOp;
      if (!op.maybeHiddenMarkers || indexOf(op.maybeHiddenMarkers, this) == -1)
        (op.maybeUnhiddenMarkers || (op.maybeUnhiddenMarkers = [])).push(this);
    }
    this.lines.push(line);
  };
  TextMarker.prototype.detachLine = function(line) {
    this.lines.splice(indexOf(this.lines, line), 1);
    if (!this.lines.length && this.doc.cm) {
      var op = this.doc.cm.curOp;
      (op.maybeHiddenMarkers || (op.maybeHiddenMarkers = [])).push(this);
    }
  };

  function markText(doc, from, to, options, type) {
    if (options && options.shared) return markTextShared(doc, from, to, options, type);
    if (doc.cm && !doc.cm.curOp) return operation(doc.cm, markText)(doc, from, to, options, type);

    var marker = new TextMarker(doc, type);
    if (type == "range" && !posLess(from, to)) return marker;
    if (options) copyObj(options, marker);
    if (marker.replacedWith) {
      marker.collapsed = true;
      marker.replacedWith = elt("span", [marker.replacedWith], "CodeMirror-widget");
    }
    if (marker.collapsed) sawCollapsedSpans = true;

    if (marker.addToHistory)
      addToHistory(doc, {from: from, to: to, origin: "markText"},
                   {head: doc.sel.head, anchor: doc.sel.anchor}, NaN);

    var curLine = from.line, size = 0, collapsedAtStart, collapsedAtEnd, cm = doc.cm, updateMaxLine;
    doc.iter(curLine, to.line + 1, function(line) {
      if (cm && marker.collapsed && !cm.options.lineWrapping && visualLine(doc, line) == cm.display.maxLine)
        updateMaxLine = true;
      var span = {from: null, to: null, marker: marker};
      size += line.text.length;
      if (curLine == from.line) {span.from = from.ch; size -= from.ch;}
      if (curLine == to.line) {span.to = to.ch; size -= line.text.length - to.ch;}
      if (marker.collapsed) {
        if (curLine == to.line) collapsedAtEnd = collapsedSpanAt(line, to.ch);
        if (curLine == from.line) collapsedAtStart = collapsedSpanAt(line, from.ch);
        else updateLineHeight(line, 0);
      }
      addMarkedSpan(line, span);
      ++curLine;
    });
    if (marker.collapsed) doc.iter(from.line, to.line + 1, function(line) {
      if (lineIsHidden(doc, line)) updateLineHeight(line, 0);
    });

    if (marker.clearOnEnter) on(marker, "beforeCursorEnter", function() { marker.clear(); });

    if (marker.readOnly) {
      sawReadOnlySpans = true;
      if (doc.history.done.length || doc.history.undone.length)
        doc.clearHistory();
    }
    if (marker.collapsed) {
      if (collapsedAtStart != collapsedAtEnd)
        throw new Error("Inserting collapsed marker overlapping an existing one");
      marker.size = size;
      marker.atomic = true;
    }
    if (cm) {
      if (updateMaxLine) cm.curOp.updateMaxLine = true;
      if (marker.className || marker.startStyle || marker.endStyle || marker.collapsed)
        regChange(cm, from.line, to.line + 1);
      if (marker.atomic) reCheckSelection(cm);
    }
    return marker;
  }

  // SHARED TEXTMARKERS

  function SharedTextMarker(markers, primary) {
    this.markers = markers;
    this.primary = primary;
    for (var i = 0, me = this; i < markers.length; ++i) {
      markers[i].parent = this;
      on(markers[i], "clear", function(){me.clear();});
    }
  }
  CodeMirror.SharedTextMarker = SharedTextMarker;

  SharedTextMarker.prototype.clear = function() {
    if (this.explicitlyCleared) return;
    this.explicitlyCleared = true;
    for (var i = 0; i < this.markers.length; ++i)
      this.markers[i].clear();
    signalLater(this, "clear");
  };
  SharedTextMarker.prototype.find = function() {
    return this.primary.find();
  };
  SharedTextMarker.prototype.getOptions = function(copyWidget) {
    var inner = this.primary.getOptions(copyWidget);
    inner.shared = true;
    return inner;
  };

  function markTextShared(doc, from, to, options, type) {
    options = copyObj(options);
    options.shared = false;
    var markers = [markText(doc, from, to, options, type)], primary = markers[0];
    var widget = options.replacedWith;
    linkedDocs(doc, function(doc) {
      if (widget) options.replacedWith = widget.cloneNode(true);
      markers.push(markText(doc, clipPos(doc, from), clipPos(doc, to), options, type));
      for (var i = 0; i < doc.linked.length; ++i)
        if (doc.linked[i].isParent) return;
      primary = lst(markers);
    });
    return new SharedTextMarker(markers, primary);
  }

  // TEXTMARKER SPANS

  function getMarkedSpanFor(spans, marker) {
    if (spans) for (var i = 0; i < spans.length; ++i) {
      var span = spans[i];
      if (span.marker == marker) return span;
    }
  }
  function removeMarkedSpan(spans, span) {
    for (var r, i = 0; i < spans.length; ++i)
      if (spans[i] != span) (r || (r = [])).push(spans[i]);
    return r;
  }
  function addMarkedSpan(line, span) {
    line.markedSpans = line.markedSpans ? line.markedSpans.concat([span]) : [span];
    span.marker.attachLine(line);
  }

  function markedSpansBefore(old, startCh, isInsert) {
    if (old) for (var i = 0, nw; i < old.length; ++i) {
      var span = old[i], marker = span.marker;
      var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= startCh : span.from < startCh);
      if (startsBefore || marker.type == "bookmark" && span.from == startCh && (!isInsert || !span.marker.insertLeft)) {
        var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= startCh : span.to > startCh);
        (nw || (nw = [])).push({from: span.from,
                                to: endsAfter ? null : span.to,
                                marker: marker});
      }
    }
    return nw;
  }

  function markedSpansAfter(old, endCh, isInsert) {
    if (old) for (var i = 0, nw; i < old.length; ++i) {
      var span = old[i], marker = span.marker;
      var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= endCh : span.to > endCh);
      if (endsAfter || marker.type == "bookmark" && span.from == endCh && (!isInsert || span.marker.insertLeft)) {
        var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= endCh : span.from < endCh);
        (nw || (nw = [])).push({from: startsBefore ? null : span.from - endCh,
                                to: span.to == null ? null : span.to - endCh,
                                marker: marker});
      }
    }
    return nw;
  }

  function stretchSpansOverChange(doc, change) {
    var oldFirst = isLine(doc, change.from.line) && getLine(doc, change.from.line).markedSpans;
    var oldLast = isLine(doc, change.to.line) && getLine(doc, change.to.line).markedSpans;
    if (!oldFirst && !oldLast) return null;

    var startCh = change.from.ch, endCh = change.to.ch, isInsert = posEq(change.from, change.to);
    // Get the spans that 'stick out' on both sides
    var first = markedSpansBefore(oldFirst, startCh, isInsert);
    var last = markedSpansAfter(oldLast, endCh, isInsert);

    // Next, merge those two ends
    var sameLine = change.text.length == 1, offset = lst(change.text).length + (sameLine ? startCh : 0);
    if (first) {
      // Fix up .to properties of first
      for (var i = 0; i < first.length; ++i) {
        var span = first[i];
        if (span.to == null) {
          var found = getMarkedSpanFor(last, span.marker);
          if (!found) span.to = startCh;
          else if (sameLine) span.to = found.to == null ? null : found.to + offset;
        }
      }
    }
    if (last) {
      // Fix up .from in last (or move them into first in case of sameLine)
      for (var i = 0; i < last.length; ++i) {
        var span = last[i];
        if (span.to != null) span.to += offset;
        if (span.from == null) {
          var found = getMarkedSpanFor(first, span.marker);
          if (!found) {
            span.from = offset;
            if (sameLine) (first || (first = [])).push(span);
          }
        } else {
          span.from += offset;
          if (sameLine) (first || (first = [])).push(span);
        }
      }
    }

    var newMarkers = [first];
    if (!sameLine) {
      // Fill gap with whole-line-spans
      var gap = change.text.length - 2, gapMarkers;
      if (gap > 0 && first)
        for (var i = 0; i < first.length; ++i)
          if (first[i].to == null)
            (gapMarkers || (gapMarkers = [])).push({from: null, to: null, marker: first[i].marker});
      for (var i = 0; i < gap; ++i)
        newMarkers.push(gapMarkers);
      newMarkers.push(last);
    }
    return newMarkers;
  }

  function mergeOldSpans(doc, change) {
    var old = getOldSpans(doc, change);
    var stretched = stretchSpansOverChange(doc, change);
    if (!old) return stretched;
    if (!stretched) return old;

    for (var i = 0; i < old.length; ++i) {
      var oldCur = old[i], stretchCur = stretched[i];
      if (oldCur && stretchCur) {
        spans: for (var j = 0; j < stretchCur.length; ++j) {
          var span = stretchCur[j];
          for (var k = 0; k < oldCur.length; ++k)
            if (oldCur[k].marker == span.marker) continue spans;
          oldCur.push(span);
        }
      } else if (stretchCur) {
        old[i] = stretchCur;
      }
    }
    return old;
  }

  function removeReadOnlyRanges(doc, from, to) {
    var markers = null;
    doc.iter(from.line, to.line + 1, function(line) {
      if (line.markedSpans) for (var i = 0; i < line.markedSpans.length; ++i) {
        var mark = line.markedSpans[i].marker;
        if (mark.readOnly && (!markers || indexOf(markers, mark) == -1))
          (markers || (markers = [])).push(mark);
      }
    });
    if (!markers) return null;
    var parts = [{from: from, to: to}];
    for (var i = 0; i < markers.length; ++i) {
      var mk = markers[i], m = mk.find();
      for (var j = 0; j < parts.length; ++j) {
        var p = parts[j];
        if (posLess(p.to, m.from) || posLess(m.to, p.from)) continue;
        var newParts = [j, 1];
        if (posLess(p.from, m.from) || !mk.inclusiveLeft && posEq(p.from, m.from))
          newParts.push({from: p.from, to: m.from});
        if (posLess(m.to, p.to) || !mk.inclusiveRight && posEq(p.to, m.to))
          newParts.push({from: m.to, to: p.to});
        parts.splice.apply(parts, newParts);
        j += newParts.length - 1;
      }
    }
    return parts;
  }

  function collapsedSpanAt(line, ch) {
    var sps = sawCollapsedSpans && line.markedSpans, found;
    if (sps) for (var sp, i = 0; i < sps.length; ++i) {
      sp = sps[i];
      if (!sp.marker.collapsed) continue;
      if ((sp.from == null || sp.from < ch) &&
          (sp.to == null || sp.to > ch) &&
          (!found || found.width < sp.marker.width))
        found = sp.marker;
    }
    return found;
  }
  function collapsedSpanAtStart(line) { return collapsedSpanAt(line, -1); }
  function collapsedSpanAtEnd(line) { return collapsedSpanAt(line, line.text.length + 1); }

  function visualLine(doc, line) {
    var merged;
    while (merged = collapsedSpanAtStart(line))
      line = getLine(doc, merged.find().from.line);
    return line;
  }

  function lineIsHidden(doc, line) {
    var sps = sawCollapsedSpans && line.markedSpans;
    if (sps) for (var sp, i = 0; i < sps.length; ++i) {
      sp = sps[i];
      if (!sp.marker.collapsed) continue;
      if (sp.from == null) return true;
      if (sp.from == 0 && sp.marker.inclusiveLeft && lineIsHiddenInner(doc, line, sp))
        return true;
    }
  }
  function lineIsHiddenInner(doc, line, span) {
    if (span.to == null) {
      var end = span.marker.find().to, endLine = getLine(doc, end.line);
      return lineIsHiddenInner(doc, endLine, getMarkedSpanFor(endLine.markedSpans, span.marker));
    }
    if (span.marker.inclusiveRight && span.to == line.text.length)
      return true;
    for (var sp, i = 0; i < line.markedSpans.length; ++i) {
      sp = line.markedSpans[i];
      if (sp.marker.collapsed && sp.from == span.to &&
          (sp.marker.inclusiveLeft || span.marker.inclusiveRight) &&
          lineIsHiddenInner(doc, line, sp)) return true;
    }
  }

  function detachMarkedSpans(line) {
    var spans = line.markedSpans;
    if (!spans) return;
    for (var i = 0; i < spans.length; ++i)
      spans[i].marker.detachLine(line);
    line.markedSpans = null;
  }

  function attachMarkedSpans(line, spans) {
    if (!spans) return;
    for (var i = 0; i < spans.length; ++i)
      spans[i].marker.attachLine(line);
    line.markedSpans = spans;
  }

  // LINE WIDGETS

  var LineWidget = CodeMirror.LineWidget = function(cm, node, options) {
    for (var opt in options) if (options.hasOwnProperty(opt))
      this[opt] = options[opt];
    this.cm = cm;
    this.node = node;
  };
  function widgetOperation(f) {
    return function() {
      var withOp = !this.cm.curOp;
      if (withOp) startOperation(this.cm);
      try {var result = f.apply(this, arguments);}
      finally {if (withOp) endOperation(this.cm);}
      return result;
    };
  }
  LineWidget.prototype.clear = widgetOperation(function() {
    var ws = this.line.widgets, no = lineNo(this.line);
    if (no == null || !ws) return;
    for (var i = 0; i < ws.length; ++i) if (ws[i] == this) ws.splice(i--, 1);
    if (!ws.length) this.line.widgets = null;
    updateLineHeight(this.line, Math.max(0, this.line.height - widgetHeight(this)));
    regChange(this.cm, no, no + 1);
  });
  LineWidget.prototype.changed = widgetOperation(function() {
    var oldH = this.height;
    this.height = null;
    var diff = widgetHeight(this) - oldH;
    if (!diff) return;
    updateLineHeight(this.line, this.line.height + diff);
    var no = lineNo(this.line);
    regChange(this.cm, no, no + 1);
  });

  function widgetHeight(widget) {
    if (widget.height != null) return widget.height;
    if (!widget.node.parentNode || widget.node.parentNode.nodeType != 1)
      removeChildrenAndAdd(widget.cm.display.measure, elt("div", [widget.node], null, "position: relative"));
    return widget.height = widget.node.offsetHeight;
  }

  function addLineWidget(cm, handle, node, options) {
    var widget = new LineWidget(cm, node, options);
    if (widget.noHScroll) cm.display.alignWidgets = true;
    changeLine(cm, handle, function(line) {
      (line.widgets || (line.widgets = [])).push(widget);
      widget.line = line;
      if (!lineIsHidden(cm.doc, line) || widget.showIfHidden) {
        var aboveVisible = heightAtLine(cm, line) < cm.display.scroller.scrollTop;
        updateLineHeight(line, line.height + widgetHeight(widget));
        if (aboveVisible) addToScrollPos(cm, 0, widget.height);
      }
      return true;
    });
    return widget;
  }

  // LINE DATA STRUCTURE

  // Line objects. These hold state related to a line, including
  // highlighting info (the styles array).
  function makeLine(text, markedSpans, estimateHeight) {
    var line = {text: text};
    attachMarkedSpans(line, markedSpans);
    line.height = estimateHeight ? estimateHeight(line) : 1;
    return line;
  }

  function updateLine(line, text, markedSpans, estimateHeight) {
    line.text = text;
    if (line.stateAfter) line.stateAfter = null;
    if (line.styles) line.styles = null;
    if (line.order != null) line.order = null;
    detachMarkedSpans(line);
    attachMarkedSpans(line, markedSpans);
    var estHeight = estimateHeight ? estimateHeight(line) : 1;
    if (estHeight != line.height) updateLineHeight(line, estHeight);
  }

  function cleanUpLine(line) {
    line.parent = null;
    detachMarkedSpans(line);
  }

  // Run the given mode's parser over a line, update the styles
  // array, which contains alternating fragments of text and CSS
  // classes.
  function runMode(cm, text, mode, state, f) {
    var flattenSpans = mode.flattenSpans;
    if (flattenSpans == null) flattenSpans = cm.options.flattenSpans;
    var curText = "", curStyle = null;
    var stream = new StringStream(text, cm.options.tabSize), style;
    if (text == "" && mode.blankLine) mode.blankLine(state);
    while (!stream.eol()) {
      if (stream.pos > cm.options.maxHighlightLength) {
        flattenSpans = false;
        // Webkit seems to refuse to render text nodes longer than 57444 characters
        stream.pos = Math.min(text.length, stream.start + 50000);
        style = null;
      } else {
        style = mode.token(stream, state);
      }
      var substr = stream.current();
      stream.start = stream.pos;
      if (!flattenSpans || curStyle != style) {
        if (curText) f(curText, curStyle);
        curText = substr; curStyle = style;
      } else curText = curText + substr;
    }
    if (curText) f(curText, curStyle);
  }

  function highlightLine(cm, line, state) {
    // A styles array always starts with a number identifying the
    // mode/overlays that it is based on (for easy invalidation).
    var st = [cm.state.modeGen];
    // Compute the base array of styles
    runMode(cm, line.text, cm.doc.mode, state, function(txt, style) {st.push(txt, style);});

    // Run overlays, adjust style array.
    for (var o = 0; o < cm.state.overlays.length; ++o) {
      var overlay = cm.state.overlays[o], i = 1;
      runMode(cm, line.text, overlay.mode, true, function(txt, style) {
        var start = i, len = txt.length;
        // Ensure there's a token end at the current position, and that i points at it
        while (len) {
          var cur = st[i], len_ = cur.length;
          if (len_ <= len) {
            len -= len_;
          } else {
            st.splice(i, 1, cur.slice(0, len), st[i+1], cur.slice(len));
            len = 0;
          }
          i += 2;
        }
        if (!style) return;
        if (overlay.opaque) {
          st.splice(start, i - start, txt, style);
          i = start + 2;
        } else {
          for (; start < i; start += 2) {
            var cur = st[start+1];
            st[start+1] = cur ? cur + " " + style : style;
          }
        }
      });
    }

    return st;
  }

  function getLineStyles(cm, line) {
    if (!line.styles || line.styles[0] != cm.state.modeGen)
      line.styles = highlightLine(cm, line, line.stateAfter = getStateBefore(cm, lineNo(line)));
    return line.styles;
  }

  // Lightweight form of highlight -- proceed over this line and
  // update state, but don't save a style array.
  function processLine(cm, line, state) {
    var mode = cm.doc.mode;
    var stream = new StringStream(line.text, cm.options.tabSize);
    if (line.text == "" && mode.blankLine) mode.blankLine(state);
    while (!stream.eol() && stream.pos <= cm.options.maxHighlightLength) {
      mode.token(stream, state);
      stream.start = stream.pos;
    }
  }

  var styleToClassCache = {};
  function styleToClass(style) {
    if (!style) return null;
    return styleToClassCache[style] ||
      (styleToClassCache[style] = "cm-" + style.replace(/ +/g, " cm-"));
  }

  function lineContent(cm, realLine, measure) {
    var merged, line = realLine, lineBefore, sawBefore, simple = true;
    while (merged = collapsedSpanAtStart(line)) {
      simple = false;
      line = getLine(cm.doc, merged.find().from.line);
      if (!lineBefore) lineBefore = line;
    }

    var builder = {pre: elt("pre"), col: 0, pos: 0, display: !measure,
                   measure: null, addedOne: false, cm: cm};
    if (line.textClass) builder.pre.className = line.textClass;

    do {
      builder.measure = line == realLine && measure;
      builder.pos = 0;
      builder.addToken = builder.measure ? buildTokenMeasure : buildToken;
      if ((ie || webkit) && cm.getOption("lineWrapping"))
        builder.addToken = buildTokenSplitSpaces(builder.addToken);
      if (measure && sawBefore && line != realLine && !builder.addedOne) {
        measure[0] = builder.pre.appendChild(zeroWidthElement(cm.display.measure));
        builder.addedOne = true;
      }
      var next = insertLineContent(line, builder, getLineStyles(cm, line));
      sawBefore = line == lineBefore;
      if (next) {
        line = getLine(cm.doc, next.to.line);
        simple = false;
      }
    } while (next);

    if (measure && !builder.addedOne)
      measure[0] = builder.pre.appendChild(simple ? elt("span", "\u00a0") : zeroWidthElement(cm.display.measure));
    if (!builder.pre.firstChild && !lineIsHidden(cm.doc, realLine))
      builder.pre.appendChild(document.createTextNode("\u00a0"));

    var order;
    // Work around problem with the reported dimensions of single-char
    // direction spans on IE (issue #1129). See also the comment in
    // cursorCoords.
    if (measure && ie && (order = getOrder(line))) {
      var l = order.length - 1;
      if (order[l].from == order[l].to) --l;
      var last = order[l], prev = order[l - 1];
      if (last.from + 1 == last.to && prev && last.level < prev.level) {
        var span = measure[builder.pos - 1];
        if (span) span.parentNode.insertBefore(span.measureRight = zeroWidthElement(cm.display.measure),
                                               span.nextSibling);
      }
    }

    signal(cm, "renderLine", cm, realLine, builder.pre);
    return builder.pre;
  }

  var tokenSpecialChars = /[\t\u0000-\u0019\u00ad\u200b\u2028\u2029\uFEFF]/g;
  function buildToken(builder, text, style, startStyle, endStyle) {
    if (!text) return;
    if (!tokenSpecialChars.test(text)) {
      builder.col += text.length;
      var content = document.createTextNode(text);
    } else {
      var content = document.createDocumentFragment(), pos = 0;
      while (true) {
        tokenSpecialChars.lastIndex = pos;
        var m = tokenSpecialChars.exec(text);
        var skipped = m ? m.index - pos : text.length - pos;
        if (skipped) {
          content.appendChild(document.createTextNode(text.slice(pos, pos + skipped)));
          builder.col += skipped;
        }
        if (!m) break;
        pos += skipped + 1;
        if (m[0] == "\t") {
          var tabSize = builder.cm.options.tabSize, tabWidth = tabSize - builder.col % tabSize;
          content.appendChild(elt("span", spaceStr(tabWidth), "cm-tab"));
          builder.col += tabWidth;
        } else {
          var token = elt("span", "\u2022", "cm-invalidchar");
          token.title = "\\u" + m[0].charCodeAt(0).toString(16);
          content.appendChild(token);
          builder.col += 1;
        }
      }
    }
    if (style || startStyle || endStyle || builder.measure) {
      var fullStyle = style || "";
      if (startStyle) fullStyle += startStyle;
      if (endStyle) fullStyle += endStyle;
      return builder.pre.appendChild(elt("span", [content], fullStyle));
    }
    builder.pre.appendChild(content);
  }

  function buildTokenMeasure(builder, text, style, startStyle, endStyle) {
    var wrapping = builder.cm.options.lineWrapping;
    for (var i = 0; i < text.length; ++i) {
      var ch = text.charAt(i), start = i == 0;
      if (ch >= "\ud800" && ch < "\udbff" && i < text.length - 1) {
        ch = text.slice(i, i + 2);
        ++i;
      } else if (i && wrapping &&
                 spanAffectsWrapping.test(text.slice(i - 1, i + 1))) {
        builder.pre.appendChild(elt("wbr"));
      }
      var span = builder.measure[builder.pos] =
        buildToken(builder, ch, style,
                   start && startStyle, i == text.length - 1 && endStyle);
      // In IE single-space nodes wrap differently than spaces
      // embedded in larger text nodes, except when set to
      // white-space: normal (issue #1268).
      if (ie && wrapping && ch == " " && i && !/\s/.test(text.charAt(i - 1)) &&
          i < text.length - 1 && !/\s/.test(text.charAt(i + 1)))
        span.style.whiteSpace = "normal";
      builder.pos += ch.length;
    }
    if (text.length) builder.addedOne = true;
  }

  function buildTokenSplitSpaces(inner) {
    function split(old) {
      var out = " ";
      for (var i = 0; i < old.length - 2; ++i) out += i % 2 ? " " : "\u00a0";
      out += " ";
      return out;
    }
    return function(builder, text, style, startStyle, endStyle) {
      return inner(builder, text.replace(/ {3,}/, split), style, startStyle, endStyle);
    };
  }

  function buildCollapsedSpan(builder, size, widget) {
    if (widget) {
      if (!builder.display) widget = widget.cloneNode(true);
      builder.pre.appendChild(widget);
      if (builder.measure && size) {
        builder.measure[builder.pos] = widget;
        builder.addedOne = true;
      }
    }
    builder.pos += size;
  }

  // Outputs a number of spans to make up a line, taking highlighting
  // and marked text into account.
  function insertLineContent(line, builder, styles) {
    var spans = line.markedSpans;
    if (!spans) {
      for (var i = 1; i < styles.length; i+=2)
        builder.addToken(builder, styles[i], styleToClass(styles[i+1]));
      return;
    }

    var allText = line.text, len = allText.length;
    var pos = 0, i = 1, text = "", style;
    var nextChange = 0, spanStyle, spanEndStyle, spanStartStyle, collapsed;
    for (;;) {
      if (nextChange == pos) { // Update current marker set
        spanStyle = spanEndStyle = spanStartStyle = "";
        collapsed = null; nextChange = Infinity;
        var foundBookmark = null;
        for (var j = 0; j < spans.length; ++j) {
          var sp = spans[j], m = sp.marker;
          if (sp.from <= pos && (sp.to == null || sp.to > pos)) {
            if (sp.to != null && nextChange > sp.to) { nextChange = sp.to; spanEndStyle = ""; }
            if (m.className) spanStyle += " " + m.className;
            if (m.startStyle && sp.from == pos) spanStartStyle += " " + m.startStyle;
            if (m.endStyle && sp.to == nextChange) spanEndStyle += " " + m.endStyle;
            if (m.collapsed && (!collapsed || collapsed.marker.width < m.width))
              collapsed = sp;
          } else if (sp.from > pos && nextChange > sp.from) {
            nextChange = sp.from;
          }
          if (m.type == "bookmark" && sp.from == pos && m.replacedWith)
            foundBookmark = m.replacedWith;
        }
        if (collapsed && (collapsed.from || 0) == pos) {
          buildCollapsedSpan(builder, (collapsed.to == null ? len : collapsed.to) - pos,
                             collapsed.from != null && collapsed.marker.replacedWith);
          if (collapsed.to == null) return collapsed.marker.find();
        }
        if (foundBookmark && !collapsed) buildCollapsedSpan(builder, 0, foundBookmark);
      }
      if (pos >= len) break;

      var upto = Math.min(len, nextChange);
      while (true) {
        if (text) {
          var end = pos + text.length;
          if (!collapsed) {
            var tokenText = end > upto ? text.slice(0, upto - pos) : text;
            builder.addToken(builder, tokenText, style ? style + spanStyle : spanStyle,
                             spanStartStyle, pos + tokenText.length == nextChange ? spanEndStyle : "");
          }
          if (end >= upto) {text = text.slice(upto - pos); pos = upto; break;}
          pos = end;
          spanStartStyle = "";
        }
        text = styles[i++]; style = styleToClass(styles[i++]);
      }
    }
  }

  // DOCUMENT DATA STRUCTURE

  function updateDoc(doc, change, markedSpans, selAfter, estimateHeight) {
    function spansFor(n) {return markedSpans ? markedSpans[n] : null;}
    function update(line, text, spans) {
      updateLine(line, text, spans, estimateHeight);
      signalLater(line, "change", line, change);
    }

    var from = change.from, to = change.to, text = change.text;
    var firstLine = getLine(doc, from.line), lastLine = getLine(doc, to.line);
    var lastText = lst(text), lastSpans = spansFor(text.length - 1), nlines = to.line - from.line;

    // First adjust the line structure
    if (from.ch == 0 && to.ch == 0 && lastText == "") {
      // This is a whole-line replace. Treated specially to make
      // sure line objects move the way they are supposed to.
      for (var i = 0, e = text.length - 1, added = []; i < e; ++i)
        added.push(makeLine(text[i], spansFor(i), estimateHeight));
      update(lastLine, lastLine.text, lastSpans);
      if (nlines) doc.remove(from.line, nlines);
      if (added.length) doc.insert(from.line, added);
    } else if (firstLine == lastLine) {
      if (text.length == 1) {
        update(firstLine, firstLine.text.slice(0, from.ch) + lastText + firstLine.text.slice(to.ch), lastSpans);
      } else {
        for (var added = [], i = 1, e = text.length - 1; i < e; ++i)
          added.push(makeLine(text[i], spansFor(i), estimateHeight));
        added.push(makeLine(lastText + firstLine.text.slice(to.ch), lastSpans, estimateHeight));
        update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
        doc.insert(from.line + 1, added);
      }
    } else if (text.length == 1) {
      update(firstLine, firstLine.text.slice(0, from.ch) + text[0] + lastLine.text.slice(to.ch), spansFor(0));
      doc.remove(from.line + 1, nlines);
    } else {
      update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
      update(lastLine, lastText + lastLine.text.slice(to.ch), lastSpans);
      for (var i = 1, e = text.length - 1, added = []; i < e; ++i)
        added.push(makeLine(text[i], spansFor(i), estimateHeight));
      if (nlines > 1) doc.remove(from.line + 1, nlines - 1);
      doc.insert(from.line + 1, added);
    }

    signalLater(doc, "change", doc, change);
    setSelection(doc, selAfter.anchor, selAfter.head, null, true);
  }

  function LeafChunk(lines) {
    this.lines = lines;
    this.parent = null;
    for (var i = 0, e = lines.length, height = 0; i < e; ++i) {
      lines[i].parent = this;
      height += lines[i].height;
    }
    this.height = height;
  }

  LeafChunk.prototype = {
    chunkSize: function() { return this.lines.length; },
    removeInner: function(at, n) {
      for (var i = at, e = at + n; i < e; ++i) {
        var line = this.lines[i];
        this.height -= line.height;
        cleanUpLine(line);
        signalLater(line, "delete");
      }
      this.lines.splice(at, n);
    },
    collapse: function(lines) {
      lines.splice.apply(lines, [lines.length, 0].concat(this.lines));
    },
    insertInner: function(at, lines, height) {
      this.height += height;
      this.lines = this.lines.slice(0, at).concat(lines).concat(this.lines.slice(at));
      for (var i = 0, e = lines.length; i < e; ++i) lines[i].parent = this;
    },
    iterN: function(at, n, op) {
      for (var e = at + n; at < e; ++at)
        if (op(this.lines[at])) return true;
    }
  };

  function BranchChunk(children) {
    this.children = children;
    var size = 0, height = 0;
    for (var i = 0, e = children.length; i < e; ++i) {
      var ch = children[i];
      size += ch.chunkSize(); height += ch.height;
      ch.parent = this;
    }
    this.size = size;
    this.height = height;
    this.parent = null;
  }

  BranchChunk.prototype = {
    chunkSize: function() { return this.size; },
    removeInner: function(at, n) {
      this.size -= n;
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at < sz) {
          var rm = Math.min(n, sz - at), oldHeight = child.height;
          child.removeInner(at, rm);
          this.height -= oldHeight - child.height;
          if (sz == rm) { this.children.splice(i--, 1); child.parent = null; }
          if ((n -= rm) == 0) break;
          at = 0;
        } else at -= sz;
      }
      if (this.size - n < 25) {
        var lines = [];
        this.collapse(lines);
        this.children = [new LeafChunk(lines)];
        this.children[0].parent = this;
      }
    },
    collapse: function(lines) {
      for (var i = 0, e = this.children.length; i < e; ++i) this.children[i].collapse(lines);
    },
    insertInner: function(at, lines, height) {
      this.size += lines.length;
      this.height += height;
      for (var i = 0, e = this.children.length; i < e; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at <= sz) {
          child.insertInner(at, lines, height);
          if (child.lines && child.lines.length > 50) {
            while (child.lines.length > 50) {
              var spilled = child.lines.splice(child.lines.length - 25, 25);
              var newleaf = new LeafChunk(spilled);
              child.height -= newleaf.height;
              this.children.splice(i + 1, 0, newleaf);
              newleaf.parent = this;
            }
            this.maybeSpill();
          }
          break;
        }
        at -= sz;
      }
    },
    maybeSpill: function() {
      if (this.children.length <= 10) return;
      var me = this;
      do {
        var spilled = me.children.splice(me.children.length - 5, 5);
        var sibling = new BranchChunk(spilled);
        if (!me.parent) { // Become the parent node
          var copy = new BranchChunk(me.children);
          copy.parent = me;
          me.children = [copy, sibling];
          me = copy;
        } else {
          me.size -= sibling.size;
          me.height -= sibling.height;
          var myIndex = indexOf(me.parent.children, me);
          me.parent.children.splice(myIndex + 1, 0, sibling);
        }
        sibling.parent = me.parent;
      } while (me.children.length > 10);
      me.parent.maybeSpill();
    },
    iterN: function(at, n, op) {
      for (var i = 0, e = this.children.length; i < e; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at < sz) {
          var used = Math.min(n, sz - at);
          if (child.iterN(at, used, op)) return true;
          if ((n -= used) == 0) break;
          at = 0;
        } else at -= sz;
      }
    }
  };

  var nextDocId = 0;
  var Doc = CodeMirror.Doc = function(text, mode, firstLine) {
    if (!(this instanceof Doc)) return new Doc(text, mode, firstLine);
    if (firstLine == null) firstLine = 0;

    BranchChunk.call(this, [new LeafChunk([makeLine("", null)])]);
    this.first = firstLine;
    this.scrollTop = this.scrollLeft = 0;
    this.cantEdit = false;
    this.history = makeHistory();
    this.frontier = firstLine;
    var start = Pos(firstLine, 0);
    this.sel = {from: start, to: start, head: start, anchor: start, shift: false, extend: false, goalColumn: null};
    this.id = ++nextDocId;
    this.modeOption = mode;

    if (typeof text == "string") text = splitLines(text);
    updateDoc(this, {from: start, to: start, text: text}, null, {head: start, anchor: start});
  };

  Doc.prototype = createObj(BranchChunk.prototype, {
    iter: function(from, to, op) {
      if (op) this.iterN(from - this.first, to - from, op);
      else this.iterN(this.first, this.first + this.size, from);
    },

    insert: function(at, lines) {
      var height = 0;
      for (var i = 0, e = lines.length; i < e; ++i) height += lines[i].height;
      this.insertInner(at - this.first, lines, height);
    },
    remove: function(at, n) { this.removeInner(at - this.first, n); },

    getValue: function(lineSep) {
      var lines = getLines(this, this.first, this.first + this.size);
      if (lineSep === false) return lines;
      return lines.join(lineSep || "\n");
    },
    setValue: function(code) {
      var top = Pos(this.first, 0), last = this.first + this.size - 1;
      makeChange(this, {from: top, to: Pos(last, getLine(this, last).text.length),
                        text: splitLines(code), origin: "setValue"},
                 {head: top, anchor: top}, true);
    },
    replaceRange: function(code, from, to, origin) {
      from = clipPos(this, from);
      to = to ? clipPos(this, to) : from;
      replaceRange(this, code, from, to, origin);
    },
    getRange: function(from, to, lineSep) {
      var lines = getBetween(this, clipPos(this, from), clipPos(this, to));
      if (lineSep === false) return lines;
      return lines.join(lineSep || "\n");
    },

    getLine: function(line) {var l = this.getLineHandle(line); return l && l.text;},
    setLine: function(line, text) {
      if (isLine(this, line))
        replaceRange(this, text, Pos(line, 0), clipPos(this, Pos(line)));
    },
    removeLine: function(line) {
      if (line) replaceRange(this, "", clipPos(this, Pos(line - 1)), clipPos(this, Pos(line)));
      else replaceRange(this, "", Pos(0, 0), clipPos(this, Pos(1, 0)));
    },

    getLineHandle: function(line) {if (isLine(this, line)) return getLine(this, line);},
    getLineNumber: function(line) {return lineNo(line);},

    lineCount: function() {return this.size;},
    firstLine: function() {return this.first;},
    lastLine: function() {return this.first + this.size - 1;},

    clipPos: function(pos) {return clipPos(this, pos);},

    getCursor: function(start) {
      var sel = this.sel, pos;
      if (start == null || start == "head") pos = sel.head;
      else if (start == "anchor") pos = sel.anchor;
      else if (start == "end" || start === false) pos = sel.to;
      else pos = sel.from;
      return copyPos(pos);
    },
    somethingSelected: function() {return !posEq(this.sel.head, this.sel.anchor);},

    setCursor: docOperation(function(line, ch, extend) {
      var pos = clipPos(this, typeof line == "number" ? Pos(line, ch || 0) : line);
      if (extend) extendSelection(this, pos);
      else setSelection(this, pos, pos);
    }),
    setSelection: docOperation(function(anchor, head) {
      setSelection(this, clipPos(this, anchor), clipPos(this, head || anchor));
    }),
    extendSelection: docOperation(function(from, to) {
      extendSelection(this, clipPos(this, from), to && clipPos(this, to));
    }),

    getSelection: function(lineSep) {return this.getRange(this.sel.from, this.sel.to, lineSep);},
    replaceSelection: function(code, collapse, origin) {
      makeChange(this, {from: this.sel.from, to: this.sel.to, text: splitLines(code), origin: origin}, collapse || "around");
    },
    undo: docOperation(function() {makeChangeFromHistory(this, "undo");}),
    redo: docOperation(function() {makeChangeFromHistory(this, "redo");}),

    setExtending: function(val) {this.sel.extend = val;},

    historySize: function() {
      var hist = this.history;
      return {undo: hist.done.length, redo: hist.undone.length};
    },
    clearHistory: function() {this.history = makeHistory();},

    markClean: function() {
      this.history.dirtyCounter = 0;
      this.history.lastOp = this.history.lastOrigin = null;
    },
    isClean: function () {return this.history.dirtyCounter == 0;},

    getHistory: function() {
      return {done: copyHistoryArray(this.history.done),
              undone: copyHistoryArray(this.history.undone)};
    },
    setHistory: function(histData) {
      var hist = this.history = makeHistory();
      hist.done = histData.done.slice(0);
      hist.undone = histData.undone.slice(0);
    },

    markText: function(from, to, options) {
      return markText(this, clipPos(this, from), clipPos(this, to), options, "range");
    },
    setBookmark: function(pos, options) {
      var realOpts = {replacedWith: options && (options.nodeType == null ? options.widget : options),
                      insertLeft: options && options.insertLeft};
      pos = clipPos(this, pos);
      return markText(this, pos, pos, realOpts, "bookmark");
    },
    findMarksAt: function(pos) {
      pos = clipPos(this, pos);
      var markers = [], spans = getLine(this, pos.line).markedSpans;
      if (spans) for (var i = 0; i < spans.length; ++i) {
        var span = spans[i];
        if ((span.from == null || span.from <= pos.ch) &&
            (span.to == null || span.to >= pos.ch))
          markers.push(span.marker.parent || span.marker);
      }
      return markers;
    },
    getAllMarks: function() {
      var markers = [];
      this.iter(function(line) {
        var sps = line.markedSpans;
        if (sps) for (var i = 0; i < sps.length; ++i)
          if (sps[i].from != null) markers.push(sps[i].marker);
      });
      return markers;
    },

    posFromIndex: function(off) {
      var ch, lineNo = this.first;
      this.iter(function(line) {
        var sz = line.text.length + 1;
        if (sz > off) { ch = off; return true; }
        off -= sz;
        ++lineNo;
      });
      return clipPos(this, Pos(lineNo, ch));
    },
    indexFromPos: function (coords) {
      coords = clipPos(this, coords);
      var index = coords.ch;
      if (coords.line < this.first || coords.ch < 0) return 0;
      this.iter(this.first, coords.line, function (line) {
        index += line.text.length + 1;
      });
      return index;
    },

    copy: function(copyHistory) {
      var doc = new Doc(getLines(this, this.first, this.first + this.size), this.modeOption, this.first);
      doc.scrollTop = this.scrollTop; doc.scrollLeft = this.scrollLeft;
      doc.sel = {from: this.sel.from, to: this.sel.to, head: this.sel.head, anchor: this.sel.anchor,
                 shift: this.sel.shift, extend: false, goalColumn: this.sel.goalColumn};
      if (copyHistory) {
        doc.history.undoDepth = this.history.undoDepth;
        doc.setHistory(this.getHistory());
      }
      return doc;
    },

    linkedDoc: function(options) {
      if (!options) options = {};
      var from = this.first, to = this.first + this.size;
      if (options.from != null && options.from > from) from = options.from;
      if (options.to != null && options.to < to) to = options.to;
      var copy = new Doc(getLines(this, from, to), options.mode || this.modeOption, from);
      if (options.sharedHist) copy.history = this.history;
      (this.linked || (this.linked = [])).push({doc: copy, sharedHist: options.sharedHist});
      copy.linked = [{doc: this, isParent: true, sharedHist: options.sharedHist}];
      return copy;
    },
    unlinkDoc: function(other) {
      if (other instanceof CodeMirror) other = other.doc;
      if (this.linked) for (var i = 0; i < this.linked.length; ++i) {
        var link = this.linked[i];
        if (link.doc != other) continue;
        this.linked.splice(i, 1);
        other.unlinkDoc(this);
        break;
      }
      // If the histories were shared, split them again
      if (other.history == this.history) {
        var splitIds = [other.id];
        linkedDocs(other, function(doc) {splitIds.push(doc.id);}, true);
        other.history = makeHistory();
        other.history.done = copyHistoryArray(this.history.done, splitIds);
        other.history.undone = copyHistoryArray(this.history.undone, splitIds);
      }
    },
    iterLinkedDocs: function(f) {linkedDocs(this, f);},

    getMode: function() {return this.mode;},
    getEditor: function() {return this.cm;}
  });

  Doc.prototype.eachLine = Doc.prototype.iter;

  // The Doc methods that should be available on CodeMirror instances
  var dontDelegate = "iter insert remove copy getEditor".split(" ");
  for (var prop in Doc.prototype) if (Doc.prototype.hasOwnProperty(prop) && indexOf(dontDelegate, prop) < 0)
    CodeMirror.prototype[prop] = (function(method) {
      return function() {return method.apply(this.doc, arguments);};
    })(Doc.prototype[prop]);

  function linkedDocs(doc, f, sharedHistOnly) {
    function propagate(doc, skip, sharedHist) {
      if (doc.linked) for (var i = 0; i < doc.linked.length; ++i) {
        var rel = doc.linked[i];
        if (rel.doc == skip) continue;
        var shared = sharedHist && rel.sharedHist;
        if (sharedHistOnly && !shared) continue;
        f(rel.doc, shared);
        propagate(rel.doc, doc, shared);
      }
    }
    propagate(doc, null, true);
  }

  function attachDoc(cm, doc) {
    if (doc.cm) throw new Error("This document is already in use.");
    cm.doc = doc;
    doc.cm = cm;
    estimateLineHeights(cm);
    loadMode(cm);
    if (!cm.options.lineWrapping) computeMaxLength(cm);
    cm.options.mode = doc.modeOption;
    regChange(cm);
  }

  // LINE UTILITIES

  function getLine(chunk, n) {
    n -= chunk.first;
    while (!chunk.lines) {
      for (var i = 0;; ++i) {
        var child = chunk.children[i], sz = child.chunkSize();
        if (n < sz) { chunk = child; break; }
        n -= sz;
      }
    }
    return chunk.lines[n];
  }

  function getBetween(doc, start, end) {
    var out = [], n = start.line;
    doc.iter(start.line, end.line + 1, function(line) {
      var text = line.text;
      if (n == end.line) text = text.slice(0, end.ch);
      if (n == start.line) text = text.slice(start.ch);
      out.push(text);
      ++n;
    });
    return out;
  }
  function getLines(doc, from, to) {
    var out = [];
    doc.iter(from, to, function(line) { out.push(line.text); });
    return out;
  }

  function updateLineHeight(line, height) {
    var diff = height - line.height;
    for (var n = line; n; n = n.parent) n.height += diff;
  }

  function lineNo(line) {
    if (line.parent == null) return null;
    var cur = line.parent, no = indexOf(cur.lines, line);
    for (var chunk = cur.parent; chunk; cur = chunk, chunk = chunk.parent) {
      for (var i = 0;; ++i) {
        if (chunk.children[i] == cur) break;
        no += chunk.children[i].chunkSize();
      }
    }
    return no + cur.first;
  }

  function lineAtHeight(chunk, h) {
    var n = chunk.first;
    outer: do {
      for (var i = 0, e = chunk.children.length; i < e; ++i) {
        var child = chunk.children[i], ch = child.height;
        if (h < ch) { chunk = child; continue outer; }
        h -= ch;
        n += child.chunkSize();
      }
      return n;
    } while (!chunk.lines);
    for (var i = 0, e = chunk.lines.length; i < e; ++i) {
      var line = chunk.lines[i], lh = line.height;
      if (h < lh) break;
      h -= lh;
    }
    return n + i;
  }

  function heightAtLine(cm, lineObj) {
    lineObj = visualLine(cm.doc, lineObj);

    var h = 0, chunk = lineObj.parent;
    for (var i = 0; i < chunk.lines.length; ++i) {
      var line = chunk.lines[i];
      if (line == lineObj) break;
      else h += line.height;
    }
    for (var p = chunk.parent; p; chunk = p, p = chunk.parent) {
      for (var i = 0; i < p.children.length; ++i) {
        var cur = p.children[i];
        if (cur == chunk) break;
        else h += cur.height;
      }
    }
    return h;
  }

  function getOrder(line) {
    var order = line.order;
    if (order == null) order = line.order = bidiOrdering(line.text);
    return order;
  }

  // HISTORY

  function makeHistory() {
    return {
      // Arrays of history events. Doing something adds an event to
      // done and clears undo. Undoing moves events from done to
      // undone, redoing moves them in the other direction.
      done: [], undone: [], undoDepth: Infinity,
      // Used to track when changes can be merged into a single undo
      // event
      lastTime: 0, lastOp: null, lastOrigin: null,
      // Used by the isClean() method
      dirtyCounter: 0
    };
  }

  function attachLocalSpans(doc, change, from, to) {
    var existing = change["spans_" + doc.id], n = 0;
    doc.iter(Math.max(doc.first, from), Math.min(doc.first + doc.size, to), function(line) {
      if (line.markedSpans)
        (existing || (existing = change["spans_" + doc.id] = {}))[n] = line.markedSpans;
      ++n;
    });
  }

  function historyChangeFromChange(doc, change) {
    var histChange = {from: change.from, to: changeEnd(change), text: getBetween(doc, change.from, change.to)};
    attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);
    linkedDocs(doc, function(doc) {attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);}, true);
    return histChange;
  }

  function addToHistory(doc, change, selAfter, opId) {
    var hist = doc.history;
    hist.undone.length = 0;
    var time = +new Date, cur = lst(hist.done);

    if (cur &&
        (hist.lastOp == opId ||
         hist.lastOrigin == change.origin && change.origin &&
         ((change.origin.charAt(0) == "+" && doc.cm && hist.lastTime > time - doc.cm.options.historyEventDelay) ||
          change.origin.charAt(0) == "*"))) {
      // Merge this change into the last event
      var last = lst(cur.changes);
      if (posEq(change.from, change.to) && posEq(change.from, last.to)) {
        // Optimized case for simple insertion -- don't want to add
        // new changesets for every character typed
        last.to = changeEnd(change);
      } else {
        // Add new sub-event
        cur.changes.push(historyChangeFromChange(doc, change));
      }
      cur.anchorAfter = selAfter.anchor; cur.headAfter = selAfter.head;
    } else {
      // Can not be merged, start a new event.
      cur = {changes: [historyChangeFromChange(doc, change)],
             anchorBefore: doc.sel.anchor, headBefore: doc.sel.head,
             anchorAfter: selAfter.anchor, headAfter: selAfter.head};
      hist.done.push(cur);
      while (hist.done.length > hist.undoDepth)
        hist.done.shift();
      if (hist.dirtyCounter < 0)
        // The user has made a change after undoing past the last clean state.
        // We can never get back to a clean state now until markClean() is called.
        hist.dirtyCounter = NaN;
      else
        hist.dirtyCounter++;
    }
    hist.lastTime = time;
    hist.lastOp = opId;
    hist.lastOrigin = change.origin;
  }

  function removeClearedSpans(spans) {
    if (!spans) return null;
    for (var i = 0, out; i < spans.length; ++i) {
      if (spans[i].marker.explicitlyCleared) { if (!out) out = spans.slice(0, i); }
      else if (out) out.push(spans[i]);
    }
    return !out ? spans : out.length ? out : null;
  }

  function getOldSpans(doc, change) {
    var found = change["spans_" + doc.id];
    if (!found) return null;
    for (var i = 0, nw = []; i < change.text.length; ++i)
      nw.push(removeClearedSpans(found[i]));
    return nw;
  }

  // Used both to provide a JSON-safe object in .getHistory, and, when
  // detaching a document, to split the history in two
  function copyHistoryArray(events, newGroup) {
    for (var i = 0, copy = []; i < events.length; ++i) {
      var event = events[i], changes = event.changes, newChanges = [];
      copy.push({changes: newChanges, anchorBefore: event.anchorBefore, headBefore: event.headBefore,
                 anchorAfter: event.anchorAfter, headAfter: event.headAfter});
      for (var j = 0; j < changes.length; ++j) {
        var change = changes[j], m;
        newChanges.push({from: change.from, to: change.to, text: change.text});
        if (newGroup) for (var prop in change) if (m = prop.match(/^spans_(\d+)$/)) {
          if (indexOf(newGroup, Number(m[1])) > -1) {
            lst(newChanges)[prop] = change[prop];
            delete change[prop];
          }
        }
      }
    }
    return copy;
  }

  // Rebasing/resetting history to deal with externally-sourced changes

  function rebaseHistSel(pos, from, to, diff) {
    if (to < pos.line) {
      pos.line += diff;
    } else if (from < pos.line) {
      pos.line = from;
      pos.ch = 0;
    }
  }

  // Tries to rebase an array of history events given a change in the
  // document. If the change touches the same lines as the event, the
  // event, and everything 'behind' it, is discarded. If the change is
  // before the event, the event's positions are updated. Uses a
  // copy-on-write scheme for the positions, to avoid having to
  // reallocate them all on every rebase, but also avoid problems with
  // shared position objects being unsafely updated.
  function rebaseHistArray(array, from, to, diff) {
    for (var i = 0; i < array.length; ++i) {
      var sub = array[i], ok = true;
      for (var j = 0; j < sub.changes.length; ++j) {
        var cur = sub.changes[j];
        if (!sub.copied) { cur.from = copyPos(cur.from); cur.to = copyPos(cur.to); }
        if (to < cur.from.line) {
          cur.from.line += diff;
          cur.to.line += diff;
        } else if (from <= cur.to.line) {
          ok = false;
          break;
        }
      }
      if (!sub.copied) {
        sub.anchorBefore = copyPos(sub.anchorBefore); sub.headBefore = copyPos(sub.headBefore);
        sub.anchorAfter = copyPos(sub.anchorAfter); sub.readAfter = copyPos(sub.headAfter);
        sub.copied = true;
      }
      if (!ok) {
        array.splice(0, i + 1);
        i = 0;
      } else {
        rebaseHistSel(sub.anchorBefore); rebaseHistSel(sub.headBefore);
        rebaseHistSel(sub.anchorAfter); rebaseHistSel(sub.headAfter);
      }
    }
  }

  function rebaseHist(hist, change) {
    var from = change.from.line, to = change.to.line, diff = change.text.length - (to - from) - 1;
    rebaseHistArray(hist.done, from, to, diff);
    rebaseHistArray(hist.undone, from, to, diff);
  }

  // EVENT OPERATORS

  function stopMethod() {e_stop(this);}
  // Ensure an event has a stop method.
  function addStop(event) {
    if (!event.stop) event.stop = stopMethod;
    return event;
  }

  function e_preventDefault(e) {
    if (e.preventDefault) e.preventDefault();
    else e.returnValue = false;
  }
  function e_stopPropagation(e) {
    if (e.stopPropagation) e.stopPropagation();
    else e.cancelBubble = true;
  }
  function e_stop(e) {e_preventDefault(e); e_stopPropagation(e);}
  CodeMirror.e_stop = e_stop;
  CodeMirror.e_preventDefault = e_preventDefault;
  CodeMirror.e_stopPropagation = e_stopPropagation;

  function e_target(e) {return e.target || e.srcElement;}
  function e_button(e) {
    var b = e.which;
    if (b == null) {
      if (e.button & 1) b = 1;
      else if (e.button & 2) b = 3;
      else if (e.button & 4) b = 2;
    }
    if (mac && e.ctrlKey && b == 1) b = 3;
    return b;
  }

  // EVENT HANDLING

  function on(emitter, type, f) {
    if (emitter.addEventListener)
      emitter.addEventListener(type, f, false);
    else if (emitter.attachEvent)
      emitter.attachEvent("on" + type, f);
    else {
      var map = emitter._handlers || (emitter._handlers = {});
      var arr = map[type] || (map[type] = []);
      arr.push(f);
    }
  }

  function off(emitter, type, f) {
    if (emitter.removeEventListener)
      emitter.removeEventListener(type, f, false);
    else if (emitter.detachEvent)
      emitter.detachEvent("on" + type, f);
    else {
      var arr = emitter._handlers && emitter._handlers[type];
      if (!arr) return;
      for (var i = 0; i < arr.length; ++i)
        if (arr[i] == f) { arr.splice(i, 1); break; }
    }
  }

  function signal(emitter, type /*, values...*/) {
    var arr = emitter._handlers && emitter._handlers[type];
    if (!arr) return;
    var args = Array.prototype.slice.call(arguments, 2);
    for (var i = 0; i < arr.length; ++i) arr[i].apply(null, args);
  }

  var delayedCallbacks, delayedCallbackDepth = 0;
  function signalLater(emitter, type /*, values...*/) {
    var arr = emitter._handlers && emitter._handlers[type];
    if (!arr) return;
    var args = Array.prototype.slice.call(arguments, 2);
    if (!delayedCallbacks) {
      ++delayedCallbackDepth;
      delayedCallbacks = [];
      setTimeout(fireDelayed, 0);
    }
    function bnd(f) {return function(){f.apply(null, args);};};
    for (var i = 0; i < arr.length; ++i)
      delayedCallbacks.push(bnd(arr[i]));
  }

  function fireDelayed() {
    --delayedCallbackDepth;
    var delayed = delayedCallbacks;
    delayedCallbacks = null;
    for (var i = 0; i < delayed.length; ++i) delayed[i]();
  }

  function hasHandler(emitter, type) {
    var arr = emitter._handlers && emitter._handlers[type];
    return arr && arr.length > 0;
  }

  CodeMirror.on = on; CodeMirror.off = off; CodeMirror.signal = signal;

  // MISC UTILITIES

  // Number of pixels added to scroller and sizer to hide scrollbar
  var scrollerCutOff = 30;

  // Returned or thrown by various protocols to signal 'I'm not
  // handling this'.
  var Pass = CodeMirror.Pass = {toString: function(){return "CodeMirror.Pass";}};

  function Delayed() {this.id = null;}
  Delayed.prototype = {set: function(ms, f) {clearTimeout(this.id); this.id = setTimeout(f, ms);}};

  // Counts the column offset in a string, taking tabs into account.
  // Used mostly to find indentation.
  function countColumn(string, end, tabSize, startIndex, startValue) {
    if (end == null) {
      end = string.search(/[^\s\u00a0]/);
      if (end == -1) end = string.length;
    }
    for (var i = startIndex || 0, n = startValue || 0; i < end; ++i) {
      if (string.charAt(i) == "\t") n += tabSize - (n % tabSize);
      else ++n;
    }
    return n;
  }
  CodeMirror.countColumn = countColumn;

  var spaceStrs = [""];
  function spaceStr(n) {
    while (spaceStrs.length <= n)
      spaceStrs.push(lst(spaceStrs) + " ");
    return spaceStrs[n];
  }

  function lst(arr) { return arr[arr.length-1]; }

  function selectInput(node) {
    if (ios) { // Mobile Safari apparently has a bug where select() is broken.
      node.selectionStart = 0;
      node.selectionEnd = node.value.length;
    } else node.select();
  }

  function indexOf(collection, elt) {
    if (collection.indexOf) return collection.indexOf(elt);
    for (var i = 0, e = collection.length; i < e; ++i)
      if (collection[i] == elt) return i;
    return -1;
  }

  function createObj(base, props) {
    function Obj() {}
    Obj.prototype = base;
    var inst = new Obj();
    if (props) copyObj(props, inst);
    return inst;
  }

  function copyObj(obj, target) {
    if (!target) target = {};
    for (var prop in obj) if (obj.hasOwnProperty(prop)) target[prop] = obj[prop];
    return target;
  }

  function emptyArray(size) {
    for (var a = [], i = 0; i < size; ++i) a.push(undefined);
    return a;
  }

  function bind(f) {
    var args = Array.prototype.slice.call(arguments, 1);
    return function(){return f.apply(null, args);};
  }

  var nonASCIISingleCaseWordChar = /[\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc]/;
  function isWordChar(ch) {
    return /\w/.test(ch) || ch > "\x80" &&
      (ch.toUpperCase() != ch.toLowerCase() || nonASCIISingleCaseWordChar.test(ch));
  }

  function isEmpty(obj) {
    for (var n in obj) if (obj.hasOwnProperty(n) && obj[n]) return false;
    return true;
  }

  var isExtendingChar = /[\u0300-\u036F\u0483-\u0487\u0488-\u0489\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\uA66F\uA670-\uA672\uA674-\uA67D\uA69F\udc00-\udfff]/;

  // DOM UTILITIES

  function elt(tag, content, className, style) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (style) e.style.cssText = style;
    if (typeof content == "string") setTextContent(e, content);
    else if (content) for (var i = 0; i < content.length; ++i) e.appendChild(content[i]);
    return e;
  }

  function removeChildren(e) {
    for (var count = e.childNodes.length; count > 0; --count)
      e.removeChild(e.firstChild);
    return e;
  }

  function removeChildrenAndAdd(parent, e) {
    return removeChildren(parent).appendChild(e);
  }

  function setTextContent(e, str) {
    if (ie_lt9) {
      e.innerHTML = "";
      e.appendChild(document.createTextNode(str));
    } else e.textContent = str;
  }

  function getRect(node) {
    return node.getBoundingClientRect();
  }
  CodeMirror.replaceGetRect = function(f) { getRect = f; };

  // FEATURE DETECTION

  // Detect drag-and-drop
  var dragAndDrop = function() {
    // There is *some* kind of drag-and-drop support in IE6-8, but I
    // couldn't get it to work yet.
    if (ie_lt9) return false;
    var div = elt('div');
    return "draggable" in div || "dragDrop" in div;
  }();

  // For a reason I have yet to figure out, some browsers disallow
  // word wrapping between certain characters *only* if a new inline
  // element is started between them. This makes it hard to reliably
  // measure the position of things, since that requires inserting an
  // extra span. This terribly fragile set of regexps matches the
  // character combinations that suffer from this phenomenon on the
  // various browsers.
  var spanAffectsWrapping = /^$/; // Won't match any two-character string
  if (gecko) spanAffectsWrapping = /$'/;
  else if (safari && !/Version\/([6-9]|\d\d)\b/.test(navigator.userAgent)) spanAffectsWrapping = /\-[^ \-?]|\?[^ !'\"\),.\-\/:;\?\]\}]/;
  else if (webkit) spanAffectsWrapping = /[~!#%&*)=+}\]|\"\.>,:;][({[<]|-[^\-?\.]|\?[\w~`@#$%\^&*(_=+{[|><]/;

  var knownScrollbarWidth;
  function scrollbarWidth(measure) {
    if (knownScrollbarWidth != null) return knownScrollbarWidth;
    var test = elt("div", null, null, "width: 50px; height: 50px; overflow-x: scroll");
    removeChildrenAndAdd(measure, test);
    if (test.offsetWidth)
      knownScrollbarWidth = test.offsetHeight - test.clientHeight;
    return knownScrollbarWidth || 0;
  }

  var zwspSupported;
  function zeroWidthElement(measure) {
    if (zwspSupported == null) {
      var test = elt("span", "\u200b");
      removeChildrenAndAdd(measure, elt("span", [test, document.createTextNode("x")]));
      if (measure.firstChild.offsetHeight != 0)
        zwspSupported = test.offsetWidth <= 1 && test.offsetHeight > 2 && !ie_lt8;
    }
    if (zwspSupported) return elt("span", "\u200b");
    else return elt("span", "\u00a0", null, "display: inline-block; width: 1px; margin-right: -1px");
  }

  // See if "".split is the broken IE version, if so, provide an
  // alternative way to split lines.
  var splitLines = "\n\nb".split(/\n/).length != 3 ? function(string) {
    var pos = 0, result = [], l = string.length;
    while (pos <= l) {
      var nl = string.indexOf("\n", pos);
      if (nl == -1) nl = string.length;
      var line = string.slice(pos, string.charAt(nl - 1) == "\r" ? nl - 1 : nl);
      var rt = line.indexOf("\r");
      if (rt != -1) {
        result.push(line.slice(0, rt));
        pos += rt + 1;
      } else {
        result.push(line);
        pos = nl + 1;
      }
    }
    return result;
  } : function(string){return string.split(/\r\n?|\n/);};
  CodeMirror.splitLines = splitLines;

  var hasSelection = window.getSelection ? function(te) {
    try { return te.selectionStart != te.selectionEnd; }
    catch(e) { return false; }
  } : function(te) {
    try {var range = te.ownerDocument.selection.createRange();}
    catch(e) {}
    if (!range || range.parentElement() != te) return false;
    return range.compareEndPoints("StartToEnd", range) != 0;
  };

  var hasCopyEvent = (function() {
    var e = elt("div");
    if ("oncopy" in e) return true;
    e.setAttribute("oncopy", "return;");
    return typeof e.oncopy == 'function';
  })();

  // KEY NAMING

  var keyNames = {3: "Enter", 8: "Backspace", 9: "Tab", 13: "Enter", 16: "Shift", 17: "Ctrl", 18: "Alt",
                  19: "Pause", 20: "CapsLock", 27: "Esc", 32: "Space", 33: "PageUp", 34: "PageDown", 35: "End",
                  36: "Home", 37: "Left", 38: "Up", 39: "Right", 40: "Down", 44: "PrintScrn", 45: "Insert",
                  46: "Delete", 59: ";", 91: "Mod", 92: "Mod", 93: "Mod", 109: "-", 107: "=", 127: "Delete",
                  186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\",
                  221: "]", 222: "'", 63276: "PageUp", 63277: "PageDown", 63275: "End", 63273: "Home",
                  63234: "Left", 63232: "Up", 63235: "Right", 63233: "Down", 63302: "Insert", 63272: "Delete"};
  CodeMirror.keyNames = keyNames;
  (function() {
    // Number keys
    for (var i = 0; i < 10; i++) keyNames[i + 48] = String(i);
    // Alphabetic keys
    for (var i = 65; i <= 90; i++) keyNames[i] = String.fromCharCode(i);
    // Function keys
    for (var i = 1; i <= 12; i++) keyNames[i + 111] = keyNames[i + 63235] = "F" + i;
  })();

  // BIDI HELPERS

  function iterateBidiSections(order, from, to, f) {
    if (!order) return f(from, to, "ltr");
    for (var i = 0; i < order.length; ++i) {
      var part = order[i];
      if (part.from < to && part.to > from || from == to && part.to == from)
        f(Math.max(part.from, from), Math.min(part.to, to), part.level == 1 ? "rtl" : "ltr");
    }
  }

  function bidiLeft(part) { return part.level % 2 ? part.to : part.from; }
  function bidiRight(part) { return part.level % 2 ? part.from : part.to; }

  function lineLeft(line) { var order = getOrder(line); return order ? bidiLeft(order[0]) : 0; }
  function lineRight(line) {
    var order = getOrder(line);
    if (!order) return line.text.length;
    return bidiRight(lst(order));
  }

  function lineStart(cm, lineN) {
    var line = getLine(cm.doc, lineN);
    var visual = visualLine(cm.doc, line);
    if (visual != line) lineN = lineNo(visual);
    var order = getOrder(visual);
    var ch = !order ? 0 : order[0].level % 2 ? lineRight(visual) : lineLeft(visual);
    return Pos(lineN, ch);
  }
  function lineEnd(cm, lineN) {
    var merged, line;
    while (merged = collapsedSpanAtEnd(line = getLine(cm.doc, lineN)))
      lineN = merged.find().to.line;
    var order = getOrder(line);
    var ch = !order ? line.text.length : order[0].level % 2 ? lineLeft(line) : lineRight(line);
    return Pos(lineN, ch);
  }

  // This is somewhat involved. It is needed in order to move
  // 'visually' through bi-directional text -- i.e., pressing left
  // should make the cursor go left, even when in RTL text. The
  // tricky part is the 'jumps', where RTL and LTR text touch each
  // other. This often requires the cursor offset to move more than
  // one unit, in order to visually move one unit.
  function moveVisually(line, start, dir, byUnit) {
    var bidi = getOrder(line);
    if (!bidi) return moveLogically(line, start, dir, byUnit);
    var moveOneUnit = byUnit ? function(pos, dir) {
      do pos += dir;
      while (pos > 0 && isExtendingChar.test(line.text.charAt(pos)));
      return pos;
    } : function(pos, dir) { return pos + dir; };
    var linedir = bidi[0].level;
    for (var i = 0; i < bidi.length; ++i) {
      var part = bidi[i], sticky = part.level % 2 == linedir;
      if ((part.from < start && part.to > start) ||
          (sticky && (part.from == start || part.to == start))) break;
    }
    var target = moveOneUnit(start, part.level % 2 ? -dir : dir);

    while (target != null) {
      if (part.level % 2 == linedir) {
        if (target < part.from || target > part.to) {
          part = bidi[i += dir];
          target = part && (dir > 0 == part.level % 2 ? moveOneUnit(part.to, -1) : moveOneUnit(part.from, 1));
        } else break;
      } else {
        if (target == bidiLeft(part)) {
          part = bidi[--i];
          target = part && bidiRight(part);
        } else if (target == bidiRight(part)) {
          part = bidi[++i];
          target = part && bidiLeft(part);
        } else break;
      }
    }

    return target < 0 || target > line.text.length ? null : target;
  }

  function moveLogically(line, start, dir, byUnit) {
    var target = start + dir;
    if (byUnit) while (target > 0 && isExtendingChar.test(line.text.charAt(target))) target += dir;
    return target < 0 || target > line.text.length ? null : target;
  }

  // Bidirectional ordering algorithm
  // See http://unicode.org/reports/tr9/tr9-13.html for the algorithm
  // that this (partially) implements.

  // One-char codes used for character types:
  // L (L):   Left-to-Right
  // R (R):   Right-to-Left
  // r (AL):  Right-to-Left Arabic
  // 1 (EN):  European Number
  // + (ES):  European Number Separator
  // % (ET):  European Number Terminator
  // n (AN):  Arabic Number
  // , (CS):  Common Number Separator
  // m (NSM): Non-Spacing Mark
  // b (BN):  Boundary Neutral
  // s (B):   Paragraph Separator
  // t (S):   Segment Separator
  // w (WS):  Whitespace
  // N (ON):  Other Neutrals

  // Returns null if characters are ordered as they appear
  // (left-to-right), or an array of sections ({from, to, level}
  // objects) in the order in which they occur visually.
  var bidiOrdering = (function() {
    // Character types for codepoints 0 to 0xff
    var lowTypes = "bbbbbbbbbtstwsbbbbbbbbbbbbbbssstwNN%%%NNNNNN,N,N1111111111NNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNbbbbbbsbbbbbbbbbbbbbbbbbbbbbbbbbb,N%%%%NNNNLNNNNN%%11NLNNN1LNNNNNLLLLLLLLLLLLLLLLLLLLLLLNLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLNLLLLLLLL";
    // Character types for codepoints 0x600 to 0x6ff
    var arabicTypes = "rrrrrrrrrrrr,rNNmmmmmmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmrrrrrrrnnnnnnnnnn%nnrrrmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmmmmmmNmmmmrrrrrrrrrrrrrrrrrr";
    function charType(code) {
      if (code <= 0xff) return lowTypes.charAt(code);
      else if (0x590 <= code && code <= 0x5f4) return "R";
      else if (0x600 <= code && code <= 0x6ff) return arabicTypes.charAt(code - 0x600);
      else if (0x700 <= code && code <= 0x8ac) return "r";
      else return "L";
    }

    var bidiRE = /[\u0590-\u05f4\u0600-\u06ff\u0700-\u08ac]/;
    var isNeutral = /[stwN]/, isStrong = /[LRr]/, countsAsLeft = /[Lb1n]/, countsAsNum = /[1n]/;
    // Browsers seem to always treat the boundaries of block elements as being L.
    var outerType = "L";

    return function(str) {
      if (!bidiRE.test(str)) return false;
      var len = str.length, types = [];
      for (var i = 0, type; i < len; ++i)
        types.push(type = charType(str.charCodeAt(i)));

      // W1. Examine each non-spacing mark (NSM) in the level run, and
      // change the type of the NSM to the type of the previous
      // character. If the NSM is at the start of the level run, it will
      // get the type of sor.
      for (var i = 0, prev = outerType; i < len; ++i) {
        var type = types[i];
        if (type == "m") types[i] = prev;
        else prev = type;
      }

      // W2. Search backwards from each instance of a European number
      // until the first strong type (R, L, AL, or sor) is found. If an
      // AL is found, change the type of the European number to Arabic
      // number.
      // W3. Change all ALs to R.
      for (var i = 0, cur = outerType; i < len; ++i) {
        var type = types[i];
        if (type == "1" && cur == "r") types[i] = "n";
        else if (isStrong.test(type)) { cur = type; if (type == "r") types[i] = "R"; }
      }

      // W4. A single European separator between two European numbers
      // changes to a European number. A single common separator between
      // two numbers of the same type changes to that type.
      for (var i = 1, prev = types[0]; i < len - 1; ++i) {
        var type = types[i];
        if (type == "+" && prev == "1" && types[i+1] == "1") types[i] = "1";
        else if (type == "," && prev == types[i+1] &&
                 (prev == "1" || prev == "n")) types[i] = prev;
        prev = type;
      }

      // W5. A sequence of European terminators adjacent to European
      // numbers changes to all European numbers.
      // W6. Otherwise, separators and terminators change to Other
      // Neutral.
      for (var i = 0; i < len; ++i) {
        var type = types[i];
        if (type == ",") types[i] = "N";
        else if (type == "%") {
          for (var end = i + 1; end < len && types[end] == "%"; ++end) {}
          var replace = (i && types[i-1] == "!") || (end < len - 1 && types[end] == "1") ? "1" : "N";
          for (var j = i; j < end; ++j) types[j] = replace;
          i = end - 1;
        }
      }

      // W7. Search backwards from each instance of a European number
      // until the first strong type (R, L, or sor) is found. If an L is
      // found, then change the type of the European number to L.
      for (var i = 0, cur = outerType; i < len; ++i) {
        var type = types[i];
        if (cur == "L" && type == "1") types[i] = "L";
        else if (isStrong.test(type)) cur = type;
      }

      // N1. A sequence of neutrals takes the direction of the
      // surrounding strong text if the text on both sides has the same
      // direction. European and Arabic numbers act as if they were R in
      // terms of their influence on neutrals. Start-of-level-run (sor)
      // and end-of-level-run (eor) are used at level run boundaries.
      // N2. Any remaining neutrals take the embedding direction.
      for (var i = 0; i < len; ++i) {
        if (isNeutral.test(types[i])) {
          for (var end = i + 1; end < len && isNeutral.test(types[end]); ++end) {}
          var before = (i ? types[i-1] : outerType) == "L";
          var after = (end < len - 1 ? types[end] : outerType) == "L";
          var replace = before || after ? "L" : "R";
          for (var j = i; j < end; ++j) types[j] = replace;
          i = end - 1;
        }
      }

      // Here we depart from the documented algorithm, in order to avoid
      // building up an actual levels array. Since there are only three
      // levels (0, 1, 2) in an implementation that doesn't take
      // explicit embedding into account, we can build up the order on
      // the fly, without following the level-based algorithm.
      var order = [], m;
      for (var i = 0; i < len;) {
        if (countsAsLeft.test(types[i])) {
          var start = i;
          for (++i; i < len && countsAsLeft.test(types[i]); ++i) {}
          order.push({from: start, to: i, level: 0});
        } else {
          var pos = i, at = order.length;
          for (++i; i < len && types[i] != "L"; ++i) {}
          for (var j = pos; j < i;) {
            if (countsAsNum.test(types[j])) {
              if (pos < j) order.splice(at, 0, {from: pos, to: j, level: 1});
              var nstart = j;
              for (++j; j < i && countsAsNum.test(types[j]); ++j) {}
              order.splice(at, 0, {from: nstart, to: j, level: 2});
              pos = j;
            } else ++j;
          }
          if (pos < i) order.splice(at, 0, {from: pos, to: i, level: 1});
        }
      }
      if (order[0].level == 1 && (m = str.match(/^\s+/))) {
        order[0].from = m[0].length;
        order.unshift({from: 0, to: m[0].length, level: 0});
      }
      if (lst(order).level == 1 && (m = str.match(/\s+$/))) {
        lst(order).to -= m[0].length;
        order.push({from: len - m[0].length, to: len, level: 0});
      }
      if (order[0].level != lst(order).level)
        order.push({from: len, to: len, level: order[0].level});

      return order;
    };
  })();

  // THE END

  CodeMirror.version = "3.12";

  return CodeMirror;
})();
CodeMirror.defineMode("css", function(config) {
  return CodeMirror.getMode(config, "text/css");
});

CodeMirror.defineMode("css-base", function(config, parserConfig) {
  "use strict";

  var indentUnit = config.indentUnit,
      hooks = parserConfig.hooks || {},
      atMediaTypes = parserConfig.atMediaTypes || {},
      atMediaFeatures = parserConfig.atMediaFeatures || {},
      propertyKeywords = parserConfig.propertyKeywords || {},
      colorKeywords = parserConfig.colorKeywords || {},
      valueKeywords = parserConfig.valueKeywords || {},
      allowNested = !!parserConfig.allowNested,
      type = null;

  function ret(style, tp) { type = tp; return style; }

  function tokenBase(stream, state) {
    var ch = stream.next();
    if (hooks[ch]) {
      // result[0] is style and result[1] is type
      var result = hooks[ch](stream, state);
      if (result !== false) return result;
    }
    if (ch == "@") {stream.eatWhile(/[\w\\\-]/); return ret("def", stream.current());}
    else if (ch == "=") ret(null, "compare");
    else if ((ch == "~" || ch == "|") && stream.eat("=")) return ret(null, "compare");
    else if (ch == "\"" || ch == "'") {
      state.tokenize = tokenString(ch);
      return state.tokenize(stream, state);
    }
    else if (ch == "#") {
      stream.eatWhile(/[\w\\\-]/);
      return ret("atom", "hash");
    }
    else if (ch == "!") {
      stream.match(/^\s*\w*/);
      return ret("keyword", "important");
    }
    else if (/\d/.test(ch)) {
      stream.eatWhile(/[\w.%]/);
      return ret("number", "unit");
    }
    else if (ch === "-") {
      if (/\d/.test(stream.peek())) {
        stream.eatWhile(/[\w.%]/);
        return ret("number", "unit");
      } else if (stream.match(/^[^-]+-/)) {
        return ret("meta", "meta");
      }
    }
    else if (/[,+>*\/]/.test(ch)) {
      return ret(null, "select-op");
    }
    else if (ch == "." && stream.match(/^-?[_a-z][_a-z0-9-]*/i)) {
      return ret("qualifier", "qualifier");
    }
    else if (ch == ":") {
      return ret("operator", ch);
    }
    else if (/[;{}\[\]\(\)]/.test(ch)) {
      return ret(null, ch);
    }
    else if (ch == "u" && stream.match("rl(")) {
      stream.backUp(1);
      state.tokenize = tokenParenthesized;
      return ret("property", "variable");
    }
    else {
      stream.eatWhile(/[\w\\\-]/);
      return ret("property", "variable");
    }
  }

  function tokenString(quote, nonInclusive) {
    return function(stream, state) {
      var escaped = false, ch;
      while ((ch = stream.next()) != null) {
        if (ch == quote && !escaped)
          break;
        escaped = !escaped && ch == "\\";
      }
      if (!escaped) {
        if (nonInclusive) stream.backUp(1);
        state.tokenize = tokenBase;
      }
      return ret("string", "string");
    };
  }

  function tokenParenthesized(stream, state) {
    stream.next(); // Must be '('
    if (!stream.match(/\s*[\"\']/, false))
      state.tokenize = tokenString(")", true);
    else
      state.tokenize = tokenBase;
    return ret(null, "(");
  }

  return {
    startState: function(base) {
      return {tokenize: tokenBase,
              baseIndent: base || 0,
              stack: []};
    },

    token: function(stream, state) {

      // Use these terms when applicable (see http://www.xanthir.com/blog/b4E50)
      //
      // rule** or **ruleset:
      // A selector + braces combo, or an at-rule.
      //
      // declaration block:
      // A sequence of declarations.
      //
      // declaration:
      // A property + colon + value combo.
      //
      // property value:
      // The entire value of a property.
      //
      // component value:
      // A single piece of a property value. Like the 5px in
      // text-shadow: 0 0 5px blue;. Can also refer to things that are
      // multiple terms, like the 1-4 terms that make up the background-size
      // portion of the background shorthand.
      //
      // term:
      // The basic unit of author-facing CSS, like a single number (5),
      // dimension (5px), string ("foo"), or function. Officially defined
      //  by the CSS 2.1 grammar (look for the 'term' production)
      //
      //
      // simple selector:
      // A single atomic selector, like a type selector, an attr selector, a
      // class selector, etc.
      //
      // compound selector:
      // One or more simple selectors without a combinator. div.example is
      // compound, div > .example is not.
      //
      // complex selector:
      // One or more compound selectors chained with combinators.
      //
      // combinator:
      // The parts of selectors that express relationships. There are four
      // currently - the space (descendant combinator), the greater-than
      // bracket (child combinator), the plus sign (next sibling combinator),
      // and the tilda (following sibling combinator).
      //
      // sequence of selectors:
      // One or more of the named type of selector chained with commas.

      state.tokenize = state.tokenize || tokenBase;
      if (state.tokenize == tokenBase && stream.eatSpace()) return null;
      var style = state.tokenize(stream, state);
      if (style && typeof style != "string") style = ret(style[0], style[1]);

      // Changing style returned based on context
      var context = state.stack[state.stack.length-1];
      if (style == "variable") {
        if (type == "variable-definition") state.stack.push("propertyValue");
        return "variable-2";
      } else if (style == "property") {
        if (context == "propertyValue"){
          if (valueKeywords[stream.current()]) {
            style = "string-2";
          } else if (colorKeywords[stream.current()]) {
            style = "keyword";
          } else {
            style = "variable-2";
          }
        } else if (context == "rule") {
          if (!propertyKeywords[stream.current()]) {
            style += " error";
          }
        } else if (context == "block") {
          // if a value is present in both property, value, or color, the order
          // of preference is property -> color -> value
          if (propertyKeywords[stream.current()]) {
            style = "property";
          } else if (colorKeywords[stream.current()]) {
            style = "keyword";
          } else if (valueKeywords[stream.current()]) {
            style = "string-2";
          } else {
            style = "tag";
          }
        } else if (!context || context == "@media{") {
          style = "tag";
        } else if (context == "@media") {
          if (atMediaTypes[stream.current()]) {
            style = "attribute"; // Known attribute
          } else if (/^(only|not)$/i.test(stream.current())) {
            style = "keyword";
          } else if (stream.current().toLowerCase() == "and") {
            style = "error"; // "and" is only allowed in @mediaType
          } else if (atMediaFeatures[stream.current()]) {
            style = "error"; // Known property, should be in @mediaType(
          } else {
            // Unknown, expecting keyword or attribute, assuming attribute
            style = "attribute error";
          }
        } else if (context == "@mediaType") {
          if (atMediaTypes[stream.current()]) {
            style = "attribute";
          } else if (stream.current().toLowerCase() == "and") {
            style = "operator";
          } else if (/^(only|not)$/i.test(stream.current())) {
            style = "error"; // Only allowed in @media
          } else if (atMediaFeatures[stream.current()]) {
            style = "error"; // Known property, should be in parentheses
          } else {
            // Unknown attribute or property, but expecting property (preceded
            // by "and"). Should be in parentheses
            style = "error";
          }
        } else if (context == "@mediaType(") {
          if (propertyKeywords[stream.current()]) {
            // do nothing, remains "property"
          } else if (atMediaTypes[stream.current()]) {
            style = "error"; // Known property, should be in parentheses
          } else if (stream.current().toLowerCase() == "and") {
            style = "operator";
          } else if (/^(only|not)$/i.test(stream.current())) {
            style = "error"; // Only allowed in @media
          } else {
            style += " error";
          }
        } else {
          style = "error";
        }
      } else if (style == "atom") {
        if(!context || context == "@media{" || context == "block") {
          style = "builtin";
        } else if (context == "propertyValue") {
          if (!/^#([0-9a-fA-f]{3}|[0-9a-fA-f]{6})$/.test(stream.current())) {
            style += " error";
          }
        } else {
          style = "error";
        }
      } else if (context == "@media" && type == "{") {
        style = "error";
      }

      // Push/pop context stack
      if (type == "{") {
        if (context == "@media" || context == "@mediaType") {
          state.stack.pop();
          state.stack[state.stack.length-1] = "@media{";
        }
        else {
          var newContext = allowNested ? "block" : "rule";
          state.stack.push(newContext);
        }
      }
      else if (type == "}") {
        var lastState = state.stack[state.stack.length - 1];
        if (lastState == "interpolation") style = "operator";
        state.stack.pop();
        if (context == "propertyValue") state.stack.pop();
      }
      else if (type == "interpolation") state.stack.push("interpolation");
      else if (type == "@media") state.stack.push("@media");
      else if (context == "@media" && /\b(keyword|attribute)\b/.test(style))
        state.stack.push("@mediaType");
      else if (context == "@mediaType" && stream.current() == ",") state.stack.pop();
      else if (context == "@mediaType" && type == "(") state.stack.push("@mediaType(");
      else if (context == "@mediaType(" && type == ")") state.stack.pop();
      else if ((context == "rule" || context == "block") && type == ":") state.stack.push("propertyValue");
      else if (context == "propertyValue" && type == ";") state.stack.pop();
      return style;
    },

    indent: function(state, textAfter) {
      var n = state.stack.length;
      if (/^\}/.test(textAfter))
        n -= state.stack[state.stack.length-1] == "propertyValue" ? 2 : 1;
      return state.baseIndent + n * indentUnit;
    },

    electricChars: "}"
  };
});

(function() {
  function keySet(array) {
    var keys = {};
    for (var i = 0; i < array.length; ++i) {
      keys[array[i]] = true;
    }
    return keys;
  }

  var atMediaTypes = keySet([
    "all", "aural", "braille", "handheld", "print", "projection", "screen",
    "tty", "tv", "embossed"
  ]);

  var atMediaFeatures = keySet([
    "width", "min-width", "max-width", "height", "min-height", "max-height",
    "device-width", "min-device-width", "max-device-width", "device-height",
    "min-device-height", "max-device-height", "aspect-ratio",
    "min-aspect-ratio", "max-aspect-ratio", "device-aspect-ratio",
    "min-device-aspect-ratio", "max-device-aspect-ratio", "color", "min-color",
    "max-color", "color-index", "min-color-index", "max-color-index",
    "monochrome", "min-monochrome", "max-monochrome", "resolution",
    "min-resolution", "max-resolution", "scan", "grid"
  ]);

  var propertyKeywords = keySet([
    "align-content", "align-items", "align-self", "alignment-adjust",
    "alignment-baseline", "anchor-point", "animation", "animation-delay",
    "animation-direction", "animation-duration", "animation-iteration-count",
    "animation-name", "animation-play-state", "animation-timing-function",
    "appearance", "azimuth", "backface-visibility", "background",
    "background-attachment", "background-clip", "background-color",
    "background-image", "background-origin", "background-position",
    "background-repeat", "background-size", "baseline-shift", "binding",
    "bleed", "bookmark-label", "bookmark-level", "bookmark-state",
    "bookmark-target", "border", "border-bottom", "border-bottom-color",
    "border-bottom-left-radius", "border-bottom-right-radius",
    "border-bottom-style", "border-bottom-width", "border-collapse",
    "border-color", "border-image", "border-image-outset",
    "border-image-repeat", "border-image-slice", "border-image-source",
    "border-image-width", "border-left", "border-left-color",
    "border-left-style", "border-left-width", "border-radius", "border-right",
    "border-right-color", "border-right-style", "border-right-width",
    "border-spacing", "border-style", "border-top", "border-top-color",
    "border-top-left-radius", "border-top-right-radius", "border-top-style",
    "border-top-width", "border-width", "bottom", "box-decoration-break",
    "box-shadow", "box-sizing", "break-after", "break-before", "break-inside",
    "caption-side", "clear", "clip", "color", "color-profile", "column-count",
    "column-fill", "column-gap", "column-rule", "column-rule-color",
    "column-rule-style", "column-rule-width", "column-span", "column-width",
    "columns", "content", "counter-increment", "counter-reset", "crop", "cue",
    "cue-after", "cue-before", "cursor", "direction", "display",
    "dominant-baseline", "drop-initial-after-adjust",
    "drop-initial-after-align", "drop-initial-before-adjust",
    "drop-initial-before-align", "drop-initial-size", "drop-initial-value",
    "elevation", "empty-cells", "fit", "fit-position", "flex", "flex-basis",
    "flex-direction", "flex-flow", "flex-grow", "flex-shrink", "flex-wrap",
    "float", "float-offset", "font", "font-feature-settings", "font-family",
    "font-kerning", "font-language-override", "font-size", "font-size-adjust",
    "font-stretch", "font-style", "font-synthesis", "font-variant",
    "font-variant-alternates", "font-variant-caps", "font-variant-east-asian",
    "font-variant-ligatures", "font-variant-numeric", "font-variant-position",
    "font-weight", "grid-cell", "grid-column", "grid-column-align",
    "grid-column-sizing", "grid-column-span", "grid-columns", "grid-flow",
    "grid-row", "grid-row-align", "grid-row-sizing", "grid-row-span",
    "grid-rows", "grid-template", "hanging-punctuation", "height", "hyphens",
    "icon", "image-orientation", "image-rendering", "image-resolution",
    "inline-box-align", "justify-content", "left", "letter-spacing",
    "line-break", "line-height", "line-stacking", "line-stacking-ruby",
    "line-stacking-shift", "line-stacking-strategy", "list-style",
    "list-style-image", "list-style-position", "list-style-type", "margin",
    "margin-bottom", "margin-left", "margin-right", "margin-top",
    "marker-offset", "marks", "marquee-direction", "marquee-loop",
    "marquee-play-count", "marquee-speed", "marquee-style", "max-height",
    "max-width", "min-height", "min-width", "move-to", "nav-down", "nav-index",
    "nav-left", "nav-right", "nav-up", "opacity", "order", "orphans", "outline",
    "outline-color", "outline-offset", "outline-style", "outline-width",
    "overflow", "overflow-style", "overflow-wrap", "overflow-x", "overflow-y",
    "padding", "padding-bottom", "padding-left", "padding-right", "padding-top",
    "page", "page-break-after", "page-break-before", "page-break-inside",
    "page-policy", "pause", "pause-after", "pause-before", "perspective",
    "perspective-origin", "pitch", "pitch-range", "play-during", "position",
    "presentation-level", "punctuation-trim", "quotes", "rendering-intent",
    "resize", "rest", "rest-after", "rest-before", "richness", "right",
    "rotation", "rotation-point", "ruby-align", "ruby-overhang",
    "ruby-position", "ruby-span", "size", "speak", "speak-as", "speak-header",
    "speak-numeral", "speak-punctuation", "speech-rate", "stress", "string-set",
    "tab-size", "table-layout", "target", "target-name", "target-new",
    "target-position", "text-align", "text-align-last", "text-decoration",
    "text-decoration-color", "text-decoration-line", "text-decoration-skip",
    "text-decoration-style", "text-emphasis", "text-emphasis-color",
    "text-emphasis-position", "text-emphasis-style", "text-height",
    "text-indent", "text-justify", "text-outline", "text-shadow",
    "text-space-collapse", "text-transform", "text-underline-position",
    "text-wrap", "top", "transform", "transform-origin", "transform-style",
    "transition", "transition-delay", "transition-duration",
    "transition-property", "transition-timing-function", "unicode-bidi",
    "vertical-align", "visibility", "voice-balance", "voice-duration",
    "voice-family", "voice-pitch", "voice-range", "voice-rate", "voice-stress",
    "voice-volume", "volume", "white-space", "widows", "width", "word-break",
    "word-spacing", "word-wrap", "z-index"
  ]);

  var colorKeywords = keySet([
    "black", "silver", "gray", "white", "maroon", "red", "purple", "fuchsia",
    "green", "lime", "olive", "yellow", "navy", "blue", "teal", "aqua"
  ]);

  var valueKeywords = keySet([
    "above", "absolute", "activeborder", "activecaption", "afar",
    "after-white-space", "ahead", "alias", "all", "all-scroll", "alternate",
    "always", "amharic", "amharic-abegede", "antialiased", "appworkspace",
    "arabic-indic", "armenian", "asterisks", "auto", "avoid", "background",
    "backwards", "baseline", "below", "bidi-override", "binary", "bengali",
    "blink", "block", "block-axis", "bold", "bolder", "border", "border-box",
    "both", "bottom", "break-all", "break-word", "button", "button-bevel",
    "buttonface", "buttonhighlight", "buttonshadow", "buttontext", "cambodian",
    "capitalize", "caps-lock-indicator", "caption", "captiontext", "caret",
    "cell", "center", "checkbox", "circle", "cjk-earthly-branch",
    "cjk-heavenly-stem", "cjk-ideographic", "clear", "clip", "close-quote",
    "col-resize", "collapse", "compact", "condensed", "contain", "content",
    "content-box", "context-menu", "continuous", "copy", "cover", "crop",
    "cross", "crosshair", "currentcolor", "cursive", "dashed", "decimal",
    "decimal-leading-zero", "default", "default-button", "destination-atop",
    "destination-in", "destination-out", "destination-over", "devanagari",
    "disc", "discard", "document", "dot-dash", "dot-dot-dash", "dotted",
    "double", "down", "e-resize", "ease", "ease-in", "ease-in-out", "ease-out",
    "element", "ellipsis", "embed", "end", "ethiopic", "ethiopic-abegede",
    "ethiopic-abegede-am-et", "ethiopic-abegede-gez", "ethiopic-abegede-ti-er",
    "ethiopic-abegede-ti-et", "ethiopic-halehame-aa-er",
    "ethiopic-halehame-aa-et", "ethiopic-halehame-am-et",
    "ethiopic-halehame-gez", "ethiopic-halehame-om-et",
    "ethiopic-halehame-sid-et", "ethiopic-halehame-so-et",
    "ethiopic-halehame-ti-er", "ethiopic-halehame-ti-et",
    "ethiopic-halehame-tig", "ew-resize", "expanded", "extra-condensed",
    "extra-expanded", "fantasy", "fast", "fill", "fixed", "flat", "footnotes",
    "forwards", "from", "geometricPrecision", "georgian", "graytext", "groove",
    "gujarati", "gurmukhi", "hand", "hangul", "hangul-consonant", "hebrew",
    "help", "hidden", "hide", "higher", "highlight", "highlighttext",
    "hiragana", "hiragana-iroha", "horizontal", "hsl", "hsla", "icon", "ignore",
    "inactiveborder", "inactivecaption", "inactivecaptiontext", "infinite",
    "infobackground", "infotext", "inherit", "initial", "inline", "inline-axis",
    "inline-block", "inline-table", "inset", "inside", "intrinsic", "invert",
    "italic", "justify", "kannada", "katakana", "katakana-iroha", "khmer",
    "landscape", "lao", "large", "larger", "left", "level", "lighter",
    "line-through", "linear", "lines", "list-item", "listbox", "listitem",
    "local", "logical", "loud", "lower", "lower-alpha", "lower-armenian",
    "lower-greek", "lower-hexadecimal", "lower-latin", "lower-norwegian",
    "lower-roman", "lowercase", "ltr", "malayalam", "match",
    "media-controls-background", "media-current-time-display",
    "media-fullscreen-button", "media-mute-button", "media-play-button",
    "media-return-to-realtime-button", "media-rewind-button",
    "media-seek-back-button", "media-seek-forward-button", "media-slider",
    "media-sliderthumb", "media-time-remaining-display", "media-volume-slider",
    "media-volume-slider-container", "media-volume-sliderthumb", "medium",
    "menu", "menulist", "menulist-button", "menulist-text",
    "menulist-textfield", "menutext", "message-box", "middle", "min-intrinsic",
    "mix", "mongolian", "monospace", "move", "multiple", "myanmar", "n-resize",
    "narrower", "ne-resize", "nesw-resize", "no-close-quote", "no-drop",
    "no-open-quote", "no-repeat", "none", "normal", "not-allowed", "nowrap",
    "ns-resize", "nw-resize", "nwse-resize", "oblique", "octal", "open-quote",
    "optimizeLegibility", "optimizeSpeed", "oriya", "oromo", "outset",
    "outside", "overlay", "overline", "padding", "padding-box", "painted",
    "paused", "persian", "plus-darker", "plus-lighter", "pointer", "portrait",
    "pre", "pre-line", "pre-wrap", "preserve-3d", "progress", "push-button",
    "radio", "read-only", "read-write", "read-write-plaintext-only", "relative",
    "repeat", "repeat-x", "repeat-y", "reset", "reverse", "rgb", "rgba",
    "ridge", "right", "round", "row-resize", "rtl", "run-in", "running",
    "s-resize", "sans-serif", "scroll", "scrollbar", "se-resize", "searchfield",
    "searchfield-cancel-button", "searchfield-decoration",
    "searchfield-results-button", "searchfield-results-decoration",
    "semi-condensed", "semi-expanded", "separate", "serif", "show", "sidama",
    "single", "skip-white-space", "slide", "slider-horizontal",
    "slider-vertical", "sliderthumb-horizontal", "sliderthumb-vertical", "slow",
    "small", "small-caps", "small-caption", "smaller", "solid", "somali",
    "source-atop", "source-in", "source-out", "source-over", "space", "square",
    "square-button", "start", "static", "status-bar", "stretch", "stroke",
    "sub", "subpixel-antialiased", "super", "sw-resize", "table",
    "table-caption", "table-cell", "table-column", "table-column-group",
    "table-footer-group", "table-header-group", "table-row", "table-row-group",
    "telugu", "text", "text-bottom", "text-top", "textarea", "textfield", "thai",
    "thick", "thin", "threeddarkshadow", "threedface", "threedhighlight",
    "threedlightshadow", "threedshadow", "tibetan", "tigre", "tigrinya-er",
    "tigrinya-er-abegede", "tigrinya-et", "tigrinya-et-abegede", "to", "top",
    "transparent", "ultra-condensed", "ultra-expanded", "underline", "up",
    "upper-alpha", "upper-armenian", "upper-greek", "upper-hexadecimal",
    "upper-latin", "upper-norwegian", "upper-roman", "uppercase", "urdu", "url",
    "vertical", "vertical-text", "visible", "visibleFill", "visiblePainted",
    "visibleStroke", "visual", "w-resize", "wait", "wave", "white", "wider",
    "window", "windowframe", "windowtext", "x-large", "x-small", "xor",
    "xx-large", "xx-small"
  ]);

  function tokenCComment(stream, state) {
    var maybeEnd = false, ch;
    while ((ch = stream.next()) != null) {
      if (maybeEnd && ch == "/") {
        state.tokenize = null;
        break;
      }
      maybeEnd = (ch == "*");
    }
    return ["comment", "comment"];
  }

  CodeMirror.defineMIME("text/css", {
    atMediaTypes: atMediaTypes,
    atMediaFeatures: atMediaFeatures,
    propertyKeywords: propertyKeywords,
    colorKeywords: colorKeywords,
    valueKeywords: valueKeywords,
    hooks: {
      "<": function(stream, state) {
        function tokenSGMLComment(stream, state) {
          var dashes = 0, ch;
          while ((ch = stream.next()) != null) {
            if (dashes >= 2 && ch == ">") {
              state.tokenize = null;
              break;
            }
            dashes = (ch == "-") ? dashes + 1 : 0;
          }
          return ["comment", "comment"];
        }
        if (stream.eat("!")) {
          state.tokenize = tokenSGMLComment;
          return tokenSGMLComment(stream, state);
        }
      },
      "/": function(stream, state) {
        if (stream.eat("*")) {
          state.tokenize = tokenCComment;
          return tokenCComment(stream, state);
        }
        return false;
      }
    },
    name: "css-base"
  });

  CodeMirror.defineMIME("text/x-scss", {
    atMediaTypes: atMediaTypes,
    atMediaFeatures: atMediaFeatures,
    propertyKeywords: propertyKeywords,
    colorKeywords: colorKeywords,
    valueKeywords: valueKeywords,
    allowNested: true,
    hooks: {
      "$": function(stream) {
        stream.match(/^[\w-]+/);
        if (stream.peek() == ":") {
          return ["variable", "variable-definition"];
        }
        return ["variable", "variable"];
      },
      "/": function(stream, state) {
        if (stream.eat("/")) {
          stream.skipToEnd();
          return ["comment", "comment"];
        } else if (stream.eat("*")) {
          state.tokenize = tokenCComment;
          return tokenCComment(stream, state);
        } else {
          return ["operator", "operator"];
        }
      },
      "#": function(stream) {
        if (stream.eat("{")) {
          return ["operator", "interpolation"];
        } else {
          stream.eatWhile(/[\w\\\-]/);
          return ["atom", "hash"];
        }
      }
    },
    name: "css-base"
  });
})();
CodeMirror.defineMode("xml", function(config, parserConfig) {
  var indentUnit = config.indentUnit;
  var multilineTagIndentFactor = parserConfig.multilineTagIndentFactor || 1;

  var Kludges = parserConfig.htmlMode ? {
    autoSelfClosers: {'area': true, 'base': true, 'br': true, 'col': true, 'command': true,
                      'embed': true, 'frame': true, 'hr': true, 'img': true, 'input': true,
                      'keygen': true, 'link': true, 'meta': true, 'param': true, 'source': true,
                      'track': true, 'wbr': true},
    implicitlyClosed: {'dd': true, 'li': true, 'optgroup': true, 'option': true, 'p': true,
                       'rp': true, 'rt': true, 'tbody': true, 'td': true, 'tfoot': true,
                       'th': true, 'tr': true},
    contextGrabbers: {
      'dd': {'dd': true, 'dt': true},
      'dt': {'dd': true, 'dt': true},
      'li': {'li': true},
      'option': {'option': true, 'optgroup': true},
      'optgroup': {'optgroup': true},
      'p': {'address': true, 'article': true, 'aside': true, 'blockquote': true, 'dir': true,
            'div': true, 'dl': true, 'fieldset': true, 'footer': true, 'form': true,
            'h1': true, 'h2': true, 'h3': true, 'h4': true, 'h5': true, 'h6': true,
            'header': true, 'hgroup': true, 'hr': true, 'menu': true, 'nav': true, 'ol': true,
            'p': true, 'pre': true, 'section': true, 'table': true, 'ul': true},
      'rp': {'rp': true, 'rt': true},
      'rt': {'rp': true, 'rt': true},
      'tbody': {'tbody': true, 'tfoot': true},
      'td': {'td': true, 'th': true},
      'tfoot': {'tbody': true},
      'th': {'td': true, 'th': true},
      'thead': {'tbody': true, 'tfoot': true},
      'tr': {'tr': true}
    },
    doNotIndent: {"pre": true},
    allowUnquoted: true,
    allowMissing: true
  } : {
    autoSelfClosers: {},
    implicitlyClosed: {},
    contextGrabbers: {},
    doNotIndent: {},
    allowUnquoted: false,
    allowMissing: false
  };
  var alignCDATA = parserConfig.alignCDATA;

  // Return variables for tokenizers
  var tagName, type;

  function inText(stream, state) {
    function chain(parser) {
      state.tokenize = parser;
      return parser(stream, state);
    }

    var ch = stream.next();
    if (ch == "<") {
      if (stream.eat("!")) {
        if (stream.eat("[")) {
          if (stream.match("CDATA[")) return chain(inBlock("atom", "]]>"));
          else return null;
        }
        else if (stream.match("--")) return chain(inBlock("comment", "-->"));
        else if (stream.match("DOCTYPE", true, true)) {
          stream.eatWhile(/[\w\._\-]/);
          return chain(doctype(1));
        }
        else return null;
      }
      else if (stream.eat("?")) {
        stream.eatWhile(/[\w\._\-]/);
        state.tokenize = inBlock("meta", "?>");
        return "meta";
      }
      else {
        var isClose = stream.eat("/");
        tagName = "";
        var c;
        while ((c = stream.eat(/[^\s\u00a0=<>\"\'\/?]/))) tagName += c;
        if (!tagName) return "error";
        type = isClose ? "closeTag" : "openTag";
        state.tokenize = inTag;
        return "tag";
      }
    }
    else if (ch == "&") {
      var ok;
      if (stream.eat("#")) {
        if (stream.eat("x")) {
          ok = stream.eatWhile(/[a-fA-F\d]/) && stream.eat(";");
        } else {
          ok = stream.eatWhile(/[\d]/) && stream.eat(";");
        }
      } else {
        ok = stream.eatWhile(/[\w\.\-:]/) && stream.eat(";");
      }
      return ok ? "atom" : "error";
    }
    else {
      stream.eatWhile(/[^&<]/);
      return null;
    }
  }

  function inTag(stream, state) {
    var ch = stream.next();
    if (ch == ">" || (ch == "/" && stream.eat(">"))) {
      state.tokenize = inText;
      type = ch == ">" ? "endTag" : "selfcloseTag";
      return "tag";
    }
    else if (ch == "=") {
      type = "equals";
      return null;
    }
    else if (/[\'\"]/.test(ch)) {
      state.tokenize = inAttribute(ch);
      return state.tokenize(stream, state);
    }
    else {
      stream.eatWhile(/[^\s\u00a0=<>\"\']/);
      return "word";
    }
  }

  function inAttribute(quote) {
    return function(stream, state) {
      while (!stream.eol()) {
        if (stream.next() == quote) {
          state.tokenize = inTag;
          break;
        }
      }
      return "string";
    };
  }

  function inBlock(style, terminator) {
    return function(stream, state) {
      while (!stream.eol()) {
        if (stream.match(terminator)) {
          state.tokenize = inText;
          break;
        }
        stream.next();
      }
      return style;
    };
  }
  function doctype(depth) {
    return function(stream, state) {
      var ch;
      while ((ch = stream.next()) != null) {
        if (ch == "<") {
          state.tokenize = doctype(depth + 1);
          return state.tokenize(stream, state);
        } else if (ch == ">") {
          if (depth == 1) {
            state.tokenize = inText;
            break;
          } else {
            state.tokenize = doctype(depth - 1);
            return state.tokenize(stream, state);
          }
        }
      }
      return "meta";
    };
  }

  var curState, curStream, setStyle;
  function pass() {
    for (var i = arguments.length - 1; i >= 0; i--) curState.cc.push(arguments[i]);
  }
  function cont() {
    pass.apply(null, arguments);
    return true;
  }

  function pushContext(tagName, startOfLine) {
    var noIndent = Kludges.doNotIndent.hasOwnProperty(tagName) || (curState.context && curState.context.noIndent);
    curState.context = {
      prev: curState.context,
      tagName: tagName,
      indent: curState.indented,
      startOfLine: startOfLine,
      noIndent: noIndent
    };
  }
  function popContext() {
    if (curState.context) curState.context = curState.context.prev;
  }

  function element(type) {
    if (type == "openTag") {
      curState.tagName = tagName;
      curState.tagStart = curStream.column();
      return cont(attributes, endtag(curState.startOfLine));
    } else if (type == "closeTag") {
      var err = false;
      if (curState.context) {
        if (curState.context.tagName != tagName) {
          if (Kludges.implicitlyClosed.hasOwnProperty(curState.context.tagName.toLowerCase())) {
            popContext();
          }
          err = !curState.context || curState.context.tagName != tagName;
        }
      } else {
        err = true;
      }
      if (err) setStyle = "error";
      return cont(endclosetag(err));
    }
    return cont();
  }
  function endtag(startOfLine) {
    return function(type) {
      var tagName = curState.tagName;
      curState.tagName = curState.tagStart = null;
      if (type == "selfcloseTag" ||
          (type == "endTag" && Kludges.autoSelfClosers.hasOwnProperty(tagName.toLowerCase()))) {
        maybePopContext(tagName.toLowerCase());
        return cont();
      }
      if (type == "endTag") {
        maybePopContext(tagName.toLowerCase());
        pushContext(tagName, startOfLine);
        return cont();
      }
      return cont();
    };
  }
  function endclosetag(err) {
    return function(type) {
      if (err) setStyle = "error";
      if (type == "endTag") { popContext(); return cont(); }
      setStyle = "error";
      return cont(arguments.callee);
    };
  }
  function maybePopContext(nextTagName) {
    var parentTagName;
    while (true) {
      if (!curState.context) {
        return;
      }
      parentTagName = curState.context.tagName.toLowerCase();
      if (!Kludges.contextGrabbers.hasOwnProperty(parentTagName) ||
          !Kludges.contextGrabbers[parentTagName].hasOwnProperty(nextTagName)) {
        return;
      }
      popContext();
    }
  }

  function attributes(type) {
    if (type == "word") {setStyle = "attribute"; return cont(attribute, attributes);}
    if (type == "endTag" || type == "selfcloseTag") return pass();
    setStyle = "error";
    return cont(attributes);
  }
  function attribute(type) {
    if (type == "equals") return cont(attvalue, attributes);
    if (!Kludges.allowMissing) setStyle = "error";
    else if (type == "word") setStyle = "attribute";
    return (type == "endTag" || type == "selfcloseTag") ? pass() : cont();
  }
  function attvalue(type) {
    if (type == "string") return cont(attvaluemaybe);
    if (type == "word" && Kludges.allowUnquoted) {setStyle = "string"; return cont();}
    setStyle = "error";
    return (type == "endTag" || type == "selfCloseTag") ? pass() : cont();
  }
  function attvaluemaybe(type) {
    if (type == "string") return cont(attvaluemaybe);
    else return pass();
  }

  return {
    startState: function() {
      return {tokenize: inText, cc: [], indented: 0, startOfLine: true, tagName: null, tagStart: null, context: null};
    },

    token: function(stream, state) {
      if (!state.tagName && stream.sol()) {
        state.startOfLine = true;
        state.indented = stream.indentation();
      }
      if (stream.eatSpace()) return null;

      setStyle = type = tagName = null;
      var style = state.tokenize(stream, state);
      state.type = type;
      if ((style || type) && style != "comment") {
        curState = state; curStream = stream;
        while (true) {
          var comb = state.cc.pop() || element;
          if (comb(type || style)) break;
        }
      }
      state.startOfLine = false;
      return setStyle || style;
    },

    indent: function(state, textAfter, fullLine) {
      var context = state.context;
      if ((state.tokenize != inTag && state.tokenize != inText) ||
          context && context.noIndent)
        return fullLine ? fullLine.match(/^(\s*)/)[0].length : 0;
      if (state.tagName) return state.tagStart + indentUnit * multilineTagIndentFactor;
      if (alignCDATA && /<!\[CDATA\[/.test(textAfter)) return 0;
      if (context && /^<\//.test(textAfter))
        context = context.prev;
      while (context && !context.startOfLine)
        context = context.prev;
      if (context) return context.indent + indentUnit;
      else return 0;
    },

    electricChars: "/",

    configuration: parserConfig.htmlMode ? "html" : "xml"
  };
});

CodeMirror.defineMIME("text/xml", "xml");
CodeMirror.defineMIME("application/xml", "xml");
if (!CodeMirror.mimeModes.hasOwnProperty("text/html"))
  CodeMirror.defineMIME("text/html", {name: "xml", htmlMode: true});

CodeMirror.defineMode("htmlmixed", function(config, parserConfig) {
  var htmlMode = CodeMirror.getMode(config, {name: "xml", htmlMode: true});
  var cssMode = CodeMirror.getMode(config, "css");

  var scriptTypes = [], scriptTypesConf = parserConfig && parserConfig.scriptTypes;
  scriptTypes.push({matches: /^(?:text|application)\/(?:x-)?(?:java|ecma)script$|^$/i,
                    mode: CodeMirror.getMode(config, "javascript")});
  if (scriptTypesConf) for (var i = 0; i < scriptTypesConf.length; ++i) {
    var conf = scriptTypesConf[i];
    scriptTypes.push({matches: conf.matches, mode: conf.mode && CodeMirror.getMode(config, conf.mode)});
  }
  scriptTypes.push({matches: /./,
                    mode: CodeMirror.getMode(config, "text/plain")});

  function html(stream, state) {
    var tagName = state.htmlState.tagName;
    var style = htmlMode.token(stream, state.htmlState);
    if (tagName == "script" && /\btag\b/.test(style) && stream.current() == ">") {
      // Script block: mode to change to depends on type attribute
      var scriptType = stream.string.slice(Math.max(0, stream.pos - 100), stream.pos).match(/\btype\s*=\s*("[^"]+"|'[^']+'|\S+)[^<]*$/i);
      scriptType = scriptType ? scriptType[1] : "";
      if (scriptType && /[\"\']/.test(scriptType.charAt(0))) scriptType = scriptType.slice(1, scriptType.length - 1);
      for (var i = 0; i < scriptTypes.length; ++i) {
        var tp = scriptTypes[i];
        if (typeof tp.matches == "string" ? scriptType == tp.matches : tp.matches.test(scriptType)) {
          if (tp.mode) {
            state.token = script;
            state.localMode = tp.mode;
            state.localState = tp.mode.startState && tp.mode.startState(htmlMode.indent(state.htmlState, ""));
          }
          break;
        }
      }
    } else if (tagName == "style" && /\btag\b/.test(style) && stream.current() == ">") {
      state.token = css;
      state.localMode = cssMode;
      state.localState = cssMode.startState(htmlMode.indent(state.htmlState, ""));
    }
    return style;
  }
  function maybeBackup(stream, pat, style) {
    var cur = stream.current();
    var close = cur.search(pat), m;
    if (close > -1) stream.backUp(cur.length - close);
    else if (m = cur.match(/<\/?$/)) {
      stream.backUp(cur.length);
      if (!stream.match(pat, false)) stream.match(cur[0]);
    }
    return style;
  }
  function script(stream, state) {
    if (stream.match(/^<\/\s*script\s*>/i, false)) {
      state.token = html;
      state.localState = state.localMode = null;
      return html(stream, state);
    }
    return maybeBackup(stream, /<\/\s*script\s*>/,
                       state.localMode.token(stream, state.localState));
  }
  function css(stream, state) {
    if (stream.match(/^<\/\s*style\s*>/i, false)) {
      state.token = html;
      state.localState = state.localMode = null;
      return html(stream, state);
    }
    return maybeBackup(stream, /<\/\s*style\s*>/,
                       cssMode.token(stream, state.localState));
  }

  return {
    startState: function() {
      var state = htmlMode.startState();
      return {token: html, localMode: null, localState: null, htmlState: state};
    },

    copyState: function(state) {
      if (state.localState)
        var local = CodeMirror.copyState(state.localMode, state.localState);
      return {token: state.token, localMode: state.localMode, localState: local,
              htmlState: CodeMirror.copyState(htmlMode, state.htmlState)};
    },

    token: function(stream, state) {
      return state.token(stream, state);
    },

    indent: function(state, textAfter) {
      if (!state.localMode || /^\s*<\//.test(textAfter))
        return htmlMode.indent(state.htmlState, textAfter);
      else if (state.localMode.indent)
        return state.localMode.indent(state.localState, textAfter);
      else
        return CodeMirror.Pass;
    },

    electricChars: "/{}:",

    innerMode: function(state) {
      return {state: state.localState || state.htmlState, mode: state.localMode || htmlMode};
    }
  };
}, "xml", "javascript", "css");

CodeMirror.defineMIME("text/html", "htmlmixed");
// TODO actually recognize syntax of TypeScript constructs

(function() {
  var ie_lt8 = /MSIE \d/.test(navigator.userAgent) &&
    (document.documentMode == null || document.documentMode < 8);

  var Pos = CodeMirror.Pos;

  var matching = {"(": ")>", ")": "(<", "[": "]>", "]": "[<", "{": "}>", "}": "{<"};
  function findMatchingBracket(cm) {
    var maxScanLen = cm.state._matchBrackets.maxScanLineLength || 10000;

    var cur = cm.getCursor(), line = cm.getLineHandle(cur.line), pos = cur.ch - 1;
    var match = (pos >= 0 && matching[line.text.charAt(pos)]) || matching[line.text.charAt(++pos)];
    if (!match) return null;
    var forward = match.charAt(1) == ">", d = forward ? 1 : -1;
    var style = cm.getTokenAt(Pos(cur.line, pos + 1)).type;

    var stack = [line.text.charAt(pos)], re = /[(){}[\]]/;
    function scan(line, lineNo, start) {
      if (!line.text) return;
      var pos = forward ? 0 : line.text.length - 1, end = forward ? line.text.length : -1;
      if (line.text.length > maxScanLen) return null;
      var checkTokenStyles = line.text.length < 1000;
      if (start != null) pos = start + d;
      for (; pos != end; pos += d) {
        var ch = line.text.charAt(pos);
        if (re.test(ch) && (!checkTokenStyles || cm.getTokenAt(Pos(lineNo, pos + 1)).type == style)) {
          var match = matching[ch];
          if (match.charAt(1) == ">" == forward) stack.push(ch);
          else if (stack.pop() != match.charAt(0)) return {pos: pos, match: false};
          else if (!stack.length) return {pos: pos, match: true};
        }
      }
    }
    for (var i = cur.line, found, e = forward ? Math.min(i + 100, cm.lineCount()) : Math.max(-1, i - 100); i != e; i+=d) {
      if (i == cur.line) found = scan(line, i, pos);
      else found = scan(cm.getLineHandle(i), i);
      if (found) break;
    }
    return {from: Pos(cur.line, pos), to: found && Pos(i, found.pos), match: found && found.match};
  }

  function matchBrackets(cm, autoclear) {
    // Disable brace matching in long lines, since it'll cause hugely slow updates
    var maxHighlightLen = cm.state._matchBrackets.maxHighlightLineLength || 1000;
    var found = findMatchingBracket(cm);
    if (!found || cm.getLine(found.from.line).length > maxHighlightLen ||
       found.to && cm.getLine(found.to.line).length > maxHighlightLen)
      return;

    var style = found.match ? "CodeMirror-matchingbracket" : "CodeMirror-nonmatchingbracket";
    var one = cm.markText(found.from, Pos(found.from.line, found.from.ch + 1), {className: style});
    var two = found.to && cm.markText(found.to, Pos(found.to.line, found.to.ch + 1), {className: style});
    // Kludge to work around the IE bug from issue #1193, where text
    // input stops going to the textare whever this fires.
    if (ie_lt8 && cm.state.focused) cm.display.input.focus();
    var clear = function() {
      cm.operation(function() { one.clear(); two && two.clear(); });
    };
    if (autoclear) setTimeout(clear, 800);
    else return clear;
  }

  var currentlyHighlighted = null;
  function doMatchBrackets(cm) {
    cm.operation(function() {
      if (currentlyHighlighted) {currentlyHighlighted(); currentlyHighlighted = null;}
      if (!cm.somethingSelected()) currentlyHighlighted = matchBrackets(cm, false);
    });
  }

  CodeMirror.defineOption("matchBrackets", false, function(cm, val, old) {
    if (old && old != CodeMirror.Init)
      cm.off("cursorActivity", doMatchBrackets);
    if (val) {
      cm.state._matchBrackets = typeof val == "object" ? val : {};
      cm.on("cursorActivity", doMatchBrackets);
    }
  });

  CodeMirror.defineExtension("matchBrackets", function() {matchBrackets(this, true);});
  CodeMirror.defineExtension("findMatchingBracket", function(){return findMatchingBracket(this);});
})();
(function() {
  var DEFAULT_BRACKETS = "()[]{}''\"\"";
  var SPACE_CHAR_REGEX = /\s/;

  CodeMirror.defineOption("autoCloseBrackets", false, function(cm, val, old) {
    var wasOn = old && old != CodeMirror.Init;
    if (val && !wasOn)
      cm.addKeyMap(buildKeymap(typeof val == "string" ? val : DEFAULT_BRACKETS));
    else if (!val && wasOn)
      cm.removeKeyMap("autoCloseBrackets");
  });

  function buildKeymap(pairs) {
    var map = {
      name : "autoCloseBrackets",
      Backspace: function(cm) {
        if (cm.somethingSelected()) return CodeMirror.Pass;
        var cur = cm.getCursor(), line = cm.getLine(cur.line);
        if (cur.ch && cur.ch < line.length &&
          pairs.indexOf(line.slice(cur.ch - 1, cur.ch + 1)) % 2 == 0)
          cm.replaceRange("", CodeMirror.Pos(cur.line, cur.ch - 1), CodeMirror.Pos(cur.line, cur.ch + 1));
        else
          return CodeMirror.Pass;
      }
    };
    var closingBrackets = "";
    for (var i = 0; i < pairs.length; i += 2) (function(left, right) {
      if (left != right) closingBrackets += right;
      function surround(cm) {
        var selection = cm.getSelection();
        cm.replaceSelection(left + selection + right);
      }
      function maybeOverwrite(cm) {
        var cur = cm.getCursor(), ahead = cm.getRange(cur, CodeMirror.Pos(cur.line, cur.ch + 1));
        if (ahead != right || cm.somethingSelected()) return CodeMirror.Pass;
        else cm.execCommand("goCharRight");
      }
      map["'" + left + "'"] = function(cm) {
        if (left == "'" && cm.getTokenAt(cm.getCursor()).type == "comment")
          return CodeMirror.Pass;
        if (cm.somethingSelected()) return surround(cm);
        if (left == right && maybeOverwrite(cm) != CodeMirror.Pass) return;
        var cur = cm.getCursor(), ahead = CodeMirror.Pos(cur.line, cur.ch + 1);
        var line = cm.getLine(cur.line), nextChar = line.charAt(cur.ch);
        if (line.length == cur.ch || closingBrackets.indexOf(nextChar) >= 0 || SPACE_CHAR_REGEX.test(nextChar))
          cm.replaceSelection(left + right, {head: ahead, anchor: ahead});
        else
          return CodeMirror.Pass;
      };
      if (left != right) map["'" + right + "'"] = maybeOverwrite;
    })(pairs.charAt(i), pairs.charAt(i + 1));
    return map;
  }
})();
// Load emmet!
//     Underscore.js 1.3.3
//     (c) 2009-2012 Jeremy Ashkenas, DocumentCloud Inc.
//     Underscore is freely distributable under the MIT license.
//     Portions of Underscore are inspired or borrowed from Prototype,
//     Oliver Steele's Functional, and John Resig's Micro-Templating.
//     For all details and documentation:
//     http://documentcloud.github.com/underscore

var _ = (function() {

  // Baseline setup
  // --------------

  // Establish the root object, `window` in the browser, or `global` on the server.
  var root = this;

  // Save the previous value of the `_` variable.
  var previousUnderscore = root._;

  // Establish the object that gets returned to break out of a loop iteration.
  var breaker = {};

  // Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  // Create quick reference variables for speed access to core prototypes.
  var slice            = ArrayProto.slice,
      unshift          = ArrayProto.unshift,
      toString         = ObjProto.toString,
      hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeForEach      = ArrayProto.forEach,
    nativeMap          = ArrayProto.map,
    nativeReduce       = ArrayProto.reduce,
    nativeReduceRight  = ArrayProto.reduceRight,
    nativeFilter       = ArrayProto.filter,
    nativeEvery        = ArrayProto.every,
    nativeSome         = ArrayProto.some,
    nativeIndexOf      = ArrayProto.indexOf,
    nativeLastIndexOf  = ArrayProto.lastIndexOf,
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind;

  // Create a safe reference to the Underscore object for use below.
  var _ = function(obj) { return new wrapper(obj); };

  // Export the Underscore object for **Node.js**, with
  // backwards-compatibility for the old `require()` API. If we're in
  // the browser, add `_` as a global object via a string identifier,
  // for Closure Compiler "advanced" mode.
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = _;
    }
    exports._ = _;
  } else {
    root['_'] = _;
  }

  // Current version.
  _.VERSION = '1.3.3';

  // Collection Functions
  // --------------------

  // The cornerstone, an `each` implementation, aka `forEach`.
  // Handles objects with the built-in `forEach`, arrays, and raw objects.
  // Delegates to **ECMAScript 5**'s native `forEach` if available.
  var each = _.each = _.forEach = function(obj, iterator, context) {
    if (obj == null) return;
    if (nativeForEach && obj.forEach === nativeForEach) {
      obj.forEach(iterator, context);
    } else if (obj.length === +obj.length) {
      for (var i = 0, l = obj.length; i < l; i++) {
        if (i in obj && iterator.call(context, obj[i], i, obj) === breaker) return;
      }
    } else {
      for (var key in obj) {
        if (_.has(obj, key)) {
          if (iterator.call(context, obj[key], key, obj) === breaker) return;
        }
      }
    }
  };

  // Return the results of applying the iterator to each element.
  // Delegates to **ECMAScript 5**'s native `map` if available.
  _.map = _.collect = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeMap && obj.map === nativeMap) return obj.map(iterator, context);
    each(obj, function(value, index, list) {
      results[results.length] = iterator.call(context, value, index, list);
    });
    if (obj.length === +obj.length) results.length = obj.length;
    return results;
  };

  // **Reduce** builds up a single result from a list of values, aka `inject`,
  // or `foldl`. Delegates to **ECMAScript 5**'s native `reduce` if available.
  _.reduce = _.foldl = _.inject = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduce && obj.reduce === nativeReduce) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduce(iterator, memo) : obj.reduce(iterator);
    }
    each(obj, function(value, index, list) {
      if (!initial) {
        memo = value;
        initial = true;
      } else {
        memo = iterator.call(context, memo, value, index, list);
      }
    });
    if (!initial) throw new TypeError('Reduce of empty array with no initial value');
    return memo;
  };

  // The right-associative version of reduce, also known as `foldr`.
  // Delegates to **ECMAScript 5**'s native `reduceRight` if available.
  _.reduceRight = _.foldr = function(obj, iterator, memo, context) {
    var initial = arguments.length > 2;
    if (obj == null) obj = [];
    if (nativeReduceRight && obj.reduceRight === nativeReduceRight) {
      if (context) iterator = _.bind(iterator, context);
      return initial ? obj.reduceRight(iterator, memo) : obj.reduceRight(iterator);
    }
    var reversed = _.toArray(obj).reverse();
    if (context && !initial) iterator = _.bind(iterator, context);
    return initial ? _.reduce(reversed, iterator, memo, context) : _.reduce(reversed, iterator);
  };

  // Return the first value which passes a truth test. Aliased as `detect`.
  _.find = _.detect = function(obj, iterator, context) {
    var result;
    any(obj, function(value, index, list) {
      if (iterator.call(context, value, index, list)) {
        result = value;
        return true;
      }
    });
    return result;
  };

  // Return all the elements that pass a truth test.
  // Delegates to **ECMAScript 5**'s native `filter` if available.
  // Aliased as `select`.
  _.filter = _.select = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    if (nativeFilter && obj.filter === nativeFilter) return obj.filter(iterator, context);
    each(obj, function(value, index, list) {
      if (iterator.call(context, value, index, list)) results[results.length] = value;
    });
    return results;
  };

  // Return all the elements for which a truth test fails.
  _.reject = function(obj, iterator, context) {
    var results = [];
    if (obj == null) return results;
    each(obj, function(value, index, list) {
      if (!iterator.call(context, value, index, list)) results[results.length] = value;
    });
    return results;
  };

  // Determine whether all of the elements match a truth test.
  // Delegates to **ECMAScript 5**'s native `every` if available.
  // Aliased as `all`.
  _.every = _.all = function(obj, iterator, context) {
    var result = true;
    if (obj == null) return result;
    if (nativeEvery && obj.every === nativeEvery) return obj.every(iterator, context);
    each(obj, function(value, index, list) {
      if (!(result = result && iterator.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if at least one element in the object matches a truth test.
  // Delegates to **ECMAScript 5**'s native `some` if available.
  // Aliased as `any`.
  var any = _.some = _.any = function(obj, iterator, context) {
    iterator || (iterator = _.identity);
    var result = false;
    if (obj == null) return result;
    if (nativeSome && obj.some === nativeSome) return obj.some(iterator, context);
    each(obj, function(value, index, list) {
      if (result || (result = iterator.call(context, value, index, list))) return breaker;
    });
    return !!result;
  };

  // Determine if a given value is included in the array or object using `===`.
  // Aliased as `contains`.
  _.include = _.contains = function(obj, target) {
    var found = false;
    if (obj == null) return found;
    if (nativeIndexOf && obj.indexOf === nativeIndexOf) return obj.indexOf(target) != -1;
    found = any(obj, function(value) {
      return value === target;
    });
    return found;
  };

  // Invoke a method (with arguments) on every item in a collection.
  _.invoke = function(obj, method) {
    var args = slice.call(arguments, 2);
    return _.map(obj, function(value) {
      return (_.isFunction(method) ? method || value : value[method]).apply(value, args);
    });
  };

  // Convenience version of a common use case of `map`: fetching a property.
  _.pluck = function(obj, key) {
    return _.map(obj, function(value){ return value[key]; });
  };

  // Return the maximum element or (element-based computation).
  _.max = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0]) return Math.max.apply(Math, obj);
    if (!iterator && _.isEmpty(obj)) return -Infinity;
    var result = {computed : -Infinity};
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      computed >= result.computed && (result = {value : value, computed : computed});
    });
    return result.value;
  };

  // Return the minimum element (or element-based computation).
  _.min = function(obj, iterator, context) {
    if (!iterator && _.isArray(obj) && obj[0] === +obj[0]) return Math.min.apply(Math, obj);
    if (!iterator && _.isEmpty(obj)) return Infinity;
    var result = {computed : Infinity};
    each(obj, function(value, index, list) {
      var computed = iterator ? iterator.call(context, value, index, list) : value;
      computed < result.computed && (result = {value : value, computed : computed});
    });
    return result.value;
  };

  // Shuffle an array.
  _.shuffle = function(obj) {
    var shuffled = [], rand;
    each(obj, function(value, index, list) {
      rand = Math.floor(Math.random() * (index + 1));
      shuffled[index] = shuffled[rand];
      shuffled[rand] = value;
    });
    return shuffled;
  };

  // Sort the object's values by a criterion produced by an iterator.
  _.sortBy = function(obj, val, context) {
    var iterator = _.isFunction(val) ? val : function(obj) { return obj[val]; };
    return _.pluck(_.map(obj, function(value, index, list) {
      return {
        value : value,
        criteria : iterator.call(context, value, index, list)
      };
    }).sort(function(left, right) {
      var a = left.criteria, b = right.criteria;
      if (a === void 0) return 1;
      if (b === void 0) return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    }), 'value');
  };

  // Groups the object's values by a criterion. Pass either a string attribute
  // to group by, or a function that returns the criterion.
  _.groupBy = function(obj, val) {
    var result = {};
    var iterator = _.isFunction(val) ? val : function(obj) { return obj[val]; };
    each(obj, function(value, index) {
      var key = iterator(value, index);
      (result[key] || (result[key] = [])).push(value);
    });
    return result;
  };

  // Use a comparator function to figure out at what index an object should
  // be inserted so as to maintain order. Uses binary search.
  _.sortedIndex = function(array, obj, iterator) {
    iterator || (iterator = _.identity);
    var low = 0, high = array.length;
    while (low < high) {
      var mid = (low + high) >> 1;
      iterator(array[mid]) < iterator(obj) ? low = mid + 1 : high = mid;
    }
    return low;
  };

  // Safely convert anything iterable into a real, live array.
  _.toArray = function(obj) {
    if (!obj)                                     return [];
    if (_.isArray(obj))                           return slice.call(obj);
    if (_.isArguments(obj))                       return slice.call(obj);
    if (obj.toArray && _.isFunction(obj.toArray)) return obj.toArray();
    return _.values(obj);
  };

  // Return the number of elements in an object.
  _.size = function(obj) {
    return _.isArray(obj) ? obj.length : _.keys(obj).length;
  };

  // Array Functions
  // ---------------

  // Get the first element of an array. Passing **n** will return the first N
  // values in the array. Aliased as `head` and `take`. The **guard** check
  // allows it to work with `_.map`.
  _.first = _.head = _.take = function(array, n, guard) {
    return (n != null) && !guard ? slice.call(array, 0, n) : array[0];
  };

  // Returns everything but the last entry of the array. Especcialy useful on
  // the arguments object. Passing **n** will return all the values in
  // the array, excluding the last N. The **guard** check allows it to work with
  // `_.map`.
  _.initial = function(array, n, guard) {
    return slice.call(array, 0, array.length - ((n == null) || guard ? 1 : n));
  };

  // Get the last element of an array. Passing **n** will return the last N
  // values in the array. The **guard** check allows it to work with `_.map`.
  _.last = function(array, n, guard) {
    if ((n != null) && !guard) {
      return slice.call(array, Math.max(array.length - n, 0));
    } else {
      return array[array.length - 1];
    }
  };

  // Returns everything but the first entry of the array. Aliased as `tail`.
  // Especially useful on the arguments object. Passing an **index** will return
  // the rest of the values in the array from that index onward. The **guard**
  // check allows it to work with `_.map`.
  _.rest = _.tail = function(array, index, guard) {
    return slice.call(array, (index == null) || guard ? 1 : index);
  };

  // Trim out all falsy values from an array.
  _.compact = function(array) {
    return _.filter(array, function(value){ return !!value; });
  };

  // Return a completely flattened version of an array.
  _.flatten = function(array, shallow) {
    return _.reduce(array, function(memo, value) {
      if (_.isArray(value)) return memo.concat(shallow ? value : _.flatten(value));
      memo[memo.length] = value;
      return memo;
    }, []);
  };

  // Return a version of the array that does not contain the specified value(s).
  _.without = function(array) {
    return _.difference(array, slice.call(arguments, 1));
  };

  // Produce a duplicate-free version of the array. If the array has already
  // been sorted, you have the option of using a faster algorithm.
  // Aliased as `unique`.
  _.uniq = _.unique = function(array, isSorted, iterator) {
    var initial = iterator ? _.map(array, iterator) : array;
    var results = [];
    // The `isSorted` flag is irrelevant if the array only contains two elements.
    if (array.length < 3) isSorted = true;
    _.reduce(initial, function (memo, value, index) {
      if (isSorted ? _.last(memo) !== value || !memo.length : !_.include(memo, value)) {
        memo.push(value);
        results.push(array[index]);
      }
      return memo;
    }, []);
    return results;
  };

  // Produce an array that contains the union: each distinct element from all of
  // the passed-in arrays.
  _.union = function() {
    return _.uniq(_.flatten(arguments, true));
  };

  // Produce an array that contains every item shared between all the
  // passed-in arrays. (Aliased as "intersect" for back-compat.)
  _.intersection = _.intersect = function(array) {
    var rest = slice.call(arguments, 1);
    return _.filter(_.uniq(array), function(item) {
      return _.every(rest, function(other) {
        return _.indexOf(other, item) >= 0;
      });
    });
  };

  // Take the difference between one array and a number of other arrays.
  // Only the elements present in just the first array will remain.
  _.difference = function(array) {
    var rest = _.flatten(slice.call(arguments, 1), true);
    return _.filter(array, function(value){ return !_.include(rest, value); });
  };

  // Zip together multiple lists into a single array -- elements that share
  // an index go together.
  _.zip = function() {
    var args = slice.call(arguments);
    var length = _.max(_.pluck(args, 'length'));
    var results = new Array(length);
    for (var i = 0; i < length; i++) results[i] = _.pluck(args, "" + i);
    return results;
  };

  // If the browser doesn't supply us with indexOf (I'm looking at you, **MSIE**),
  // we need this function. Return the position of the first occurrence of an
  // item in an array, or -1 if the item is not included in the array.
  // Delegates to **ECMAScript 5**'s native `indexOf` if available.
  // If the array is large and already in sort order, pass `true`
  // for **isSorted** to use binary search.
  _.indexOf = function(array, item, isSorted) {
    if (array == null) return -1;
    var i, l;
    if (isSorted) {
      i = _.sortedIndex(array, item);
      return array[i] === item ? i : -1;
    }
    if (nativeIndexOf && array.indexOf === nativeIndexOf) return array.indexOf(item);
    for (i = 0, l = array.length; i < l; i++) if (i in array && array[i] === item) return i;
    return -1;
  };

  // Delegates to **ECMAScript 5**'s native `lastIndexOf` if available.
  _.lastIndexOf = function(array, item) {
    if (array == null) return -1;
    if (nativeLastIndexOf && array.lastIndexOf === nativeLastIndexOf) return array.lastIndexOf(item);
    var i = array.length;
    while (i--) if (i in array && array[i] === item) return i;
    return -1;
  };

  // Generate an integer Array containing an arithmetic progression. A port of
  // the native Python `range()` function. See
  // [the Python documentation](http://docs.python.org/library/functions.html#range).
  _.range = function(start, stop, step) {
    if (arguments.length <= 1) {
      stop = start || 0;
      start = 0;
    }
    step = arguments[2] || 1;

    var len = Math.max(Math.ceil((stop - start) / step), 0);
    var idx = 0;
    var range = new Array(len);

    while(idx < len) {
      range[idx++] = start;
      start += step;
    }

    return range;
  };

  // Function (ahem) Functions
  // ------------------

  // Reusable constructor function for prototype setting.
  var ctor = function(){};

  // Create a function bound to a given object (assigning `this`, and arguments,
  // optionally). Binding with arguments is also known as `curry`.
  // Delegates to **ECMAScript 5**'s native `Function.bind` if available.
  // We check for `func.bind` first, to fail fast when `func` is undefined.
  _.bind = function bind(func, context) {
    var bound, args;
    if (func.bind === nativeBind && nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
    if (!_.isFunction(func)) throw new TypeError;
    args = slice.call(arguments, 2);
    return bound = function() {
      if (!(this instanceof bound)) return func.apply(context, args.concat(slice.call(arguments)));
      ctor.prototype = func.prototype;
      var self = new ctor;
      var result = func.apply(self, args.concat(slice.call(arguments)));
      if (Object(result) === result) return result;
      return self;
    };
  };

  // Bind all of an object's methods to that object. Useful for ensuring that
  // all callbacks defined on an object belong to it.
  _.bindAll = function(obj) {
    var funcs = slice.call(arguments, 1);
    if (funcs.length == 0) funcs = _.functions(obj);
    each(funcs, function(f) { obj[f] = _.bind(obj[f], obj); });
    return obj;
  };

  // Memoize an expensive function by storing its results.
  _.memoize = function(func, hasher) {
    var memo = {};
    hasher || (hasher = _.identity);
    return function() {
      var key = hasher.apply(this, arguments);
      return _.has(memo, key) ? memo[key] : (memo[key] = func.apply(this, arguments));
    };
  };

  // Delays a function for the given number of milliseconds, and then calls
  // it with the arguments supplied.
  _.delay = function(func, wait) {
    var args = slice.call(arguments, 2);
    return setTimeout(function(){ return func.apply(null, args); }, wait);
  };

  // Defers a function, scheduling it to run after the current call stack has
  // cleared.
  _.defer = function(func) {
    return _.delay.apply(_, [func, 1].concat(slice.call(arguments, 1)));
  };

  // Returns a function, that, when invoked, will only be triggered at most once
  // during a given window of time.
  _.throttle = function(func, wait) {
    var context, args, timeout, throttling, more, result;
    var whenDone = _.debounce(function(){ more = throttling = false; }, wait);
    return function() {
      context = this; args = arguments;
      var later = function() {
        timeout = null;
        if (more) func.apply(context, args);
        whenDone();
      };
      if (!timeout) timeout = setTimeout(later, wait);
      if (throttling) {
        more = true;
      } else {
        result = func.apply(context, args);
      }
      whenDone();
      throttling = true;
      return result;
    };
  };

  // Returns a function, that, as long as it continues to be invoked, will not
  // be triggered. The function will be called after it stops being called for
  // N milliseconds. If `immediate` is passed, trigger the function on the
  // leading edge, instead of the trailing.
  _.debounce = function(func, wait, immediate) {
    var timeout;
    return function() {
      var context = this, args = arguments;
      var later = function() {
        timeout = null;
        if (!immediate) func.apply(context, args);
      };
      if (immediate && !timeout) func.apply(context, args);
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  };

  // Returns a function that will be executed at most one time, no matter how
  // often you call it. Useful for lazy initialization.
  _.once = function(func) {
    var ran = false, memo;
    return function() {
      if (ran) return memo;
      ran = true;
      return memo = func.apply(this, arguments);
    };
  };

  // Returns the first function passed as an argument to the second,
  // allowing you to adjust arguments, run code before and after, and
  // conditionally execute the original function.
  _.wrap = function(func, wrapper) {
    return function() {
      var args = [func].concat(slice.call(arguments, 0));
      return wrapper.apply(this, args);
    };
  };

  // Returns a function that is the composition of a list of functions, each
  // consuming the return value of the function that follows.
  _.compose = function() {
    var funcs = arguments;
    return function() {
      var args = arguments;
      for (var i = funcs.length - 1; i >= 0; i--) {
        args = [funcs[i].apply(this, args)];
      }
      return args[0];
    };
  };

  // Returns a function that will only be executed after being called N times.
  _.after = function(times, func) {
    if (times <= 0) return func();
    return function() {
      if (--times < 1) { return func.apply(this, arguments); }
    };
  };

  // Object Functions
  // ----------------

  // Retrieve the names of an object's properties.
  // Delegates to **ECMAScript 5**'s native `Object.keys`
  _.keys = nativeKeys || function(obj) {
    if (obj !== Object(obj)) throw new TypeError('Invalid object');
    var keys = [];
    for (var key in obj) if (_.has(obj, key)) keys[keys.length] = key;
    return keys;
  };

  // Retrieve the values of an object's properties.
  _.values = function(obj) {
    return _.map(obj, _.identity);
  };

  // Return a sorted list of the function names available on the object.
  // Aliased as `methods`
  _.functions = _.methods = function(obj) {
    var names = [];
    for (var key in obj) {
      if (_.isFunction(obj[key])) names.push(key);
    }
    return names.sort();
  };

  // Extend a given object with all the properties in passed-in object(s).
  _.extend = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      for (var prop in source) {
        obj[prop] = source[prop];
      }
    });
    return obj;
  };

  // Return a copy of the object only containing the whitelisted properties.
  _.pick = function(obj) {
    var result = {};
    each(_.flatten(slice.call(arguments, 1)), function(key) {
      if (key in obj) result[key] = obj[key];
    });
    return result;
  };

  // Fill in a given object with default properties.
  _.defaults = function(obj) {
    each(slice.call(arguments, 1), function(source) {
      for (var prop in source) {
        if (obj[prop] == null) obj[prop] = source[prop];
      }
    });
    return obj;
  };

  // Create a (shallow-cloned) duplicate of an object.
  _.clone = function(obj) {
    if (!_.isObject(obj)) return obj;
    return _.isArray(obj) ? obj.slice() : _.extend({}, obj);
  };

  // Invokes interceptor with the obj, and then returns obj.
  // The primary purpose of this method is to "tap into" a method chain, in
  // order to perform operations on intermediate results within the chain.
  _.tap = function(obj, interceptor) {
    interceptor(obj);
    return obj;
  };

  // Internal recursive comparison function.
  function eq(a, b, stack) {
    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the Harmony `egal` proposal: http://wiki.ecmascript.org/doku.php?id=harmony:egal.
    if (a === b) return a !== 0 || 1 / a == 1 / b;
    // A strict comparison is necessary because `null == undefined`.
    if (a == null || b == null) return a === b;
    // Unwrap any wrapped objects.
    if (a._chain) a = a._wrapped;
    if (b._chain) b = b._wrapped;
    // Invoke a custom `isEqual` method if one is provided.
    if (a.isEqual && _.isFunction(a.isEqual)) return a.isEqual(b);
    if (b.isEqual && _.isFunction(b.isEqual)) return b.isEqual(a);
    // Compare `[[Class]]` names.
    var className = toString.call(a);
    if (className != toString.call(b)) return false;
    switch (className) {
      // Strings, numbers, dates, and booleans are compared by value.
      case '[object String]':
        // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
        // equivalent to `new String("5")`.
        return a == String(b);
      case '[object Number]':
        // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for
        // other numeric values.
        return a != +a ? b != +b : (a == 0 ? 1 / a == 1 / b : a == +b);
      case '[object Date]':
      case '[object Boolean]':
        // Coerce dates and booleans to numeric primitive values. Dates are compared by their
        // millisecond representations. Note that invalid dates with millisecond representations
        // of `NaN` are not equivalent.
        return +a == +b;
      // RegExps are compared by their source patterns and flags.
      case '[object RegExp]':
        return a.source == b.source &&
               a.global == b.global &&
               a.multiline == b.multiline &&
               a.ignoreCase == b.ignoreCase;
    }
    if (typeof a != 'object' || typeof b != 'object') return false;
    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
    var length = stack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (stack[length] == a) return true;
    }
    // Add the first object to the stack of traversed objects.
    stack.push(a);
    var size = 0, result = true;
    // Recursively compare objects and arrays.
    if (className == '[object Array]') {
      // Compare array lengths to determine if a deep comparison is necessary.
      size = a.length;
      result = size == b.length;
      if (result) {
        // Deep compare the contents, ignoring non-numeric properties.
        while (size--) {
          // Ensure commutative equality for sparse arrays.
          if (!(result = size in a == size in b && eq(a[size], b[size], stack))) break;
        }
      }
    } else {
      // Objects with different constructors are not equivalent.
      if ('constructor' in a != 'constructor' in b || a.constructor != b.constructor) return false;
      // Deep compare objects.
      for (var key in a) {
        if (_.has(a, key)) {
          // Count the expected number of properties.
          size++;
          // Deep compare each member.
          if (!(result = _.has(b, key) && eq(a[key], b[key], stack))) break;
        }
      }
      // Ensure that both objects contain the same number of properties.
      if (result) {
        for (key in b) {
          if (_.has(b, key) && !(size--)) break;
        }
        result = !size;
      }
    }
    // Remove the first object from the stack of traversed objects.
    stack.pop();
    return result;
  }

  // Perform a deep comparison to check if two objects are equal.
  _.isEqual = function(a, b) {
    return eq(a, b, []);
  };

  // Is a given array, string, or object empty?
  // An "empty" object has no enumerable own-properties.
  _.isEmpty = function(obj) {
    if (obj == null) return true;
    if (_.isArray(obj) || _.isString(obj)) return obj.length === 0;
    for (var key in obj) if (_.has(obj, key)) return false;
    return true;
  };

  // Is a given value a DOM element?
  _.isElement = function(obj) {
    return !!(obj && obj.nodeType == 1);
  };

  // Is a given value an array?
  // Delegates to ECMA5's native Array.isArray
  _.isArray = nativeIsArray || function(obj) {
    return toString.call(obj) == '[object Array]';
  };

  // Is a given variable an object?
  _.isObject = function(obj) {
    return obj === Object(obj);
  };

  // Is a given variable an arguments object?
  _.isArguments = function(obj) {
    return toString.call(obj) == '[object Arguments]';
  };
  if (!_.isArguments(arguments)) {
    _.isArguments = function(obj) {
      return !!(obj && _.has(obj, 'callee'));
    };
  }

  // Is a given value a function?
  _.isFunction = function(obj) {
    return toString.call(obj) == '[object Function]';
  };

  // Is a given value a string?
  _.isString = function(obj) {
    return toString.call(obj) == '[object String]';
  };

  // Is a given value a number?
  _.isNumber = function(obj) {
    return toString.call(obj) == '[object Number]';
  };

  // Is a given object a finite number?
  _.isFinite = function(obj) {
    return _.isNumber(obj) && isFinite(obj);
  };

  // Is the given value `NaN`?
  _.isNaN = function(obj) {
    // `NaN` is the only value for which `===` is not reflexive.
    return obj !== obj;
  };

  // Is a given value a boolean?
  _.isBoolean = function(obj) {
    return obj === true || obj === false || toString.call(obj) == '[object Boolean]';
  };

  // Is a given value a date?
  _.isDate = function(obj) {
    return toString.call(obj) == '[object Date]';
  };

  // Is the given value a regular expression?
  _.isRegExp = function(obj) {
    return toString.call(obj) == '[object RegExp]';
  };

  // Is a given value equal to null?
  _.isNull = function(obj) {
    return obj === null;
  };

  // Is a given variable undefined?
  _.isUndefined = function(obj) {
    return obj === void 0;
  };

  // Has own property?
  _.has = function(obj, key) {
    return hasOwnProperty.call(obj, key);
  };

  // Utility Functions
  // -----------------

  // Run Underscore.js in *noConflict* mode, returning the `_` variable to its
  // previous owner. Returns a reference to the Underscore object.
  _.noConflict = function() {
    root._ = previousUnderscore;
    return this;
  };

  // Keep the identity function around for default iterators.
  _.identity = function(value) {
    return value;
  };

  // Run a function **n** times.
  _.times = function (n, iterator, context) {
    for (var i = 0; i < n; i++) iterator.call(context, i);
  };

  // Escape a string for HTML interpolation.
  _.escape = function(string) {
    return (''+string).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/\//g,'&#x2F;');
  };

  // If the value of the named property is a function then invoke it;
  // otherwise, return it.
  _.result = function(object, property) {
    if (object == null) return null;
    var value = object[property];
    return _.isFunction(value) ? value.call(object) : value;
  };

  // Add your own custom functions to the Underscore object, ensuring that
  // they're correctly added to the OOP wrapper as well.
  _.mixin = function(obj) {
    each(_.functions(obj), function(name){
      addToWrapper(name, _[name] = obj[name]);
    });
  };

  // Generate a unique integer id (unique within the entire client session).
  // Useful for temporary DOM ids.
  var idCounter = 0;
  _.uniqueId = function(prefix) {
    var id = idCounter++;
    return prefix ? prefix + id : id;
  };

  // By default, Underscore uses ERB-style template delimiters, change the
  // following template settings to use alternative delimiters.
  _.templateSettings = {
    evaluate    : /<%([\s\S]+?)%>/g,
    interpolate : /<%=([\s\S]+?)%>/g,
    escape      : /<%-([\s\S]+?)%>/g
  };

  // When customizing `templateSettings`, if you don't want to define an
  // interpolation, evaluation or escaping regex, we need one that is
  // guaranteed not to match.
  var noMatch = /.^/;

  // Certain characters need to be escaped so that they can be put into a
  // string literal.
  var escapes = {
    '\\': '\\',
    "'": "'",
    'r': '\r',
    'n': '\n',
    't': '\t',
    'u2028': '\u2028',
    'u2029': '\u2029'
  };

  for (var p in escapes) escapes[escapes[p]] = p;
  var escaper = /\\|'|\r|\n|\t|\u2028|\u2029/g;
  var unescaper = /\\(\\|'|r|n|t|u2028|u2029)/g;

  // Within an interpolation, evaluation, or escaping, remove HTML escaping
  // that had been previously added.
  var unescape = function(code) {
    return code.replace(unescaper, function(match, escape) {
      return escapes[escape];
    });
  };

  // JavaScript micro-templating, similar to John Resig's implementation.
  // Underscore templating handles arbitrary delimiters, preserves whitespace,
  // and correctly escapes quotes within interpolated code.
  _.template = function(text, data, settings) {
    settings = _.defaults(settings || {}, _.templateSettings);

    // Compile the template source, taking care to escape characters that
    // cannot be included in a string literal and then unescape them in code
    // blocks.
    var source = "__p+='" + text
      .replace(escaper, function(match) {
        return '\\' + escapes[match];
      })
      .replace(settings.escape || noMatch, function(match, code) {
        return "'+\n_.escape(" + unescape(code) + ")+\n'";
      })
      .replace(settings.interpolate || noMatch, function(match, code) {
        return "'+\n(" + unescape(code) + ")+\n'";
      })
      .replace(settings.evaluate || noMatch, function(match, code) {
        return "';\n" + unescape(code) + "\n;__p+='";
      }) + "';\n";

    // If a variable is not specified, place data values in local scope.
    if (!settings.variable) source = 'with(obj||{}){\n' + source + '}\n';

    source = "var __p='';" +
      "var print=function(){__p+=Array.prototype.join.call(arguments, '')};\n" +
      source + "return __p;\n";

    var render = new Function(settings.variable || 'obj', '_', source);
    if (data) return render(data, _);
    var template = function(data) {
      return render.call(this, data, _);
    };

    // Provide the compiled function source as a convenience for build time
    // precompilation.
    template.source = 'function(' + (settings.variable || 'obj') + '){\n' +
      source + '}';

    return template;
  };

  // Add a "chain" function, which will delegate to the wrapper.
  _.chain = function(obj) {
    return _(obj).chain();
  };

  // The OOP Wrapper
  // ---------------

  // If Underscore is called as a function, it returns a wrapped object that
  // can be used OO-style. This wrapper holds altered versions of all the
  // underscore functions. Wrapped objects may be chained.
  var wrapper = function(obj) { this._wrapped = obj; };

  // Expose `wrapper.prototype` as `_.prototype`
  _.prototype = wrapper.prototype;

  // Helper function to continue chaining intermediate results.
  var result = function(obj, chain) {
    return chain ? _(obj).chain() : obj;
  };

  // A method to easily add functions to the OOP wrapper.
  var addToWrapper = function(name, func) {
    wrapper.prototype[name] = function() {
      var args = slice.call(arguments);
      unshift.call(args, this._wrapped);
      return result(func.apply(_, args), this._chain);
    };
  };

  // Add all of the Underscore functions to the wrapper object.
  _.mixin(_);

  // Add all mutator Array functions to the wrapper.
  each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
    var method = ArrayProto[name];
    wrapper.prototype[name] = function() {
      var wrapped = this._wrapped;
      method.apply(wrapped, arguments);
      var length = wrapped.length;
      if ((name == 'shift' || name == 'splice') && length === 0) delete wrapped[0];
      return result(wrapped, this._chain);
    };
  });

  // Add all accessor Array functions to the wrapper.
  each(['concat', 'join', 'slice'], function(name) {
    var method = ArrayProto[name];
    wrapper.prototype[name] = function() {
      return result(method.apply(this._wrapped, arguments), this._chain);
    };
  });

  // Start chaining a wrapped Underscore object.
  wrapper.prototype.chain = function() {
    this._chain = true;
    return this;
  };

  // Extracts the result from a wrapped and chained object.
  wrapper.prototype.value = function() {
    return this._wrapped;
  };
  return _;
}).call({});
/**
 * Core Emmet object, available in global scope
 */
var emmet = (function(global) {
  var defaultSyntax = 'html';
  var defaultProfile = 'plain';
  
  if (typeof _ == 'undefined') {
    try {
      // avoid collisions with RequireJS loader
      // also, JS obfuscators tends to translate
      // a["name"] to a.name, which also breaks RequireJS
      _ = global[['require'][0]]('underscore'); // node.js
    } catch (e) {}
  }

  if (typeof _ == 'undefined') {
    throw 'Cannot access to Underscore.js lib';
  }

  /** List of registered modules */
  var modules = {
    _ : _
  };
  
  /**
   * Shared empty constructor function to aid in prototype-chain creation.
   */
  var ctor = function(){};
  
  /**
   * Helper function to correctly set up the prototype chain, for subclasses.
   * Similar to `goog.inherits`, but uses a hash of prototype properties and
   * class properties to be extended.
   * Took it from Backbone.
   * @param {Object} parent
   * @param {Object} protoProps
   * @param {Object} staticProps
   * @returns {Object}
   */
  function inherits(parent, protoProps, staticProps) {
    var child;

    // The constructor function for the new subclass is either defined by
    // you (the "constructor" property in your `extend` definition), or
    // defaulted by us to simply call the parent's constructor.
    if (protoProps && protoProps.hasOwnProperty('constructor')) {
      child = protoProps.constructor;
    } else {
      child = function() {
        parent.apply(this, arguments);
      };
    }

    // Inherit class (static) properties from parent.
    _.extend(child, parent);

    // Set the prototype chain to inherit from `parent`, without calling
    // `parent`'s constructor function.
    ctor.prototype = parent.prototype;
    child.prototype = new ctor();

    // Add prototype properties (instance properties) to the subclass,
    // if supplied.
    if (protoProps)
      _.extend(child.prototype, protoProps);

    // Add static properties to the constructor function, if supplied.
    if (staticProps)
      _.extend(child, staticProps);

    // Correctly set child's `prototype.constructor`.
    child.prototype.constructor = child;

    // Set a convenience property in case the parent's prototype is needed
    // later.
    child.__super__ = parent.prototype;

    return child;
  };
  
  /**
   * @type Function Function that loads module definition if it's not defined
   */
  var moduleLoader = null;
  
  /**
   * Generic Emmet module loader (actually, it doesn’t load anything, just 
   * returns module reference). Not using `require` name to avoid conflicts
   * with Node.js and RequireJS
   */
  function r(name) {
    if (!(name in modules) && moduleLoader)
      moduleLoader(name);
    
    return modules[name];
  }
  
  return {
    /**
     * Simple, AMD-like module definition. The module will be added into
     * <code>emmet</code> object and will be available via
     * <code>emmet.require(name)</code> or <code>emmet[name]</code>
     * @param {String} name
     * @param {Function} factory
     * @memberOf emmet
     */
    define: function(name, factory) {
      // do not let redefine existing properties
      if (!(name in modules)) {
        modules[name] = _.isFunction(factory) 
          ? this.exec(factory)
          : factory;
      }
    },
    
    /**
     * Returns reference to Emmet module
     * @param {String} name Module name
     */
    require: r,
    
    /**
     * Helper method that just executes passed function but with all 
     * important arguments like 'require' and '_'
     * @param {Function} fn
     * @param {Object} context Execution context
     */
    exec: function(fn, context) {
      return fn.call(context || global, _.bind(r, this), _, this);
    },
    
    /**
     * The self-propagating extend function for classes.
     * Took it from Backbone 
     * @param {Object} protoProps
     * @param {Object} classProps
     * @returns {Object}
     */
    extend: function(protoProps, classProps) {
      var child = inherits(this, protoProps, classProps);
      child.extend = this.extend;
      // a hack required to WSH inherit `toString` method
      if (protoProps.hasOwnProperty('toString'))
        child.prototype.toString = protoProps.toString;
      return child;
    },
    
    /**
     * The essential function that expands Emmet abbreviation
     * @param {String} abbr Abbreviation to parse
     * @param {String} syntax Abbreviation's context syntax
     * @param {String} profile Output profile (or its name)
     * @param {Object} contextNode Contextual node where abbreviation is
     * written
     * @return {String}
     */
    expandAbbreviation: function(abbr, syntax, profile, contextNode) {
      if (!abbr) return '';
      
      syntax = syntax || defaultSyntax;
//      profile = profile || defaultProfile;
      
      var filters = r('filters');
      var parser = r('abbreviationParser');
      
      profile = r('profile').get(profile, syntax);
      r('tabStops').resetTabstopIndex();
      
      var data = filters.extractFromAbbreviation(abbr);
      var outputTree = parser.parse(data[0], {
        syntax: syntax, 
        contextNode: contextNode
      });
      
      var filtersList = filters.composeList(syntax, profile, data[1]);
      filters.apply(outputTree, filtersList, profile);
      return outputTree.toString();
    },
    
    /**
     * Returns default syntax name used in abbreviation engine
     * @returns {String}
     */
    defaultSyntax: function() {
      return defaultSyntax;
    },
    
    /**
     * Returns default profile name used in abbreviation engine
     * @returns {String}
     */
    defaultProfile: function() {
      return defaultProfile;
    },
    
    /**
     * Log message into console if it exists
     */
    log: function() {
      if (global.console && global.console.log)
        global.console.log.apply(global.console, arguments);
    },
    
    /**
     * Setups function that should synchronously load undefined modules
     * @param {Function} fn
     */
    setModuleLoader: function(fn) {
      moduleLoader = fn;
    }
  };
})(this);

// export core for Node.JS
if (typeof exports !== 'undefined') {
  if (typeof module !== 'undefined' && module.exports) {
    exports = module.exports = emmet;
  }
  exports.emmet = emmet;
}

// export as Require.js module
if (typeof define !== 'undefined') {
  define(emmet);
}/**
 * Emmet abbreviation parser.
 * Takes string abbreviation and recursively parses it into a tree. The parsed 
 * tree can be transformed into a string representation with 
 * <code>toString()</code> method. Note that string representation is defined
 * by custom processors (called <i>filters</i>), not by abbreviation parser 
 * itself.
 * 
 * This module can be extended with custom pre-/post-processors to shape-up
 * final tree or its representation. Actually, many features of abbreviation 
 * engine are defined in other modules as tree processors
 * 
 * 
 * @author Sergey Chikuyonok (serge.che@gmail.com)
 * @link http://chikuyonok.ru
 * @memberOf __abbreviationParser
 * @constructor
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('abbreviationParser', function(require, _) {
  var reValidName = /^[\w\-\$\:@\!%]+\+?$/i;
  var reWord = /[\w\-:\$@]/;
  
  var pairs = {
    '[': ']',
    '(': ')',
    '{': '}'
  };
  
  var spliceFn = Array.prototype.splice;
  
  var preprocessors = [];
  var postprocessors = [];
  var outputProcessors = [];
  
  /**
   * @type AbbreviationNode
   */
  function AbbreviationNode(parent) {
    /** @type AbbreviationNode */
    this.parent = null;
    this.children = [];
    this._attributes = [];
    
    /** @type String Raw abbreviation for current node */
    this.abbreviation = '';
    this.counter = 1;
    this._name = null;
    this._text = '';
    this.repeatCount = 1;
    this.hasImplicitRepeat = false;
    
    /** Custom data dictionary */
    this._data = {};
    
    // output properties
    this.start = '';
    this.end = '';
    this.content = '';
    this.padding = '';
  }
  
  AbbreviationNode.prototype = {
    /**
     * Adds passed node as child or creates new child
     * @param {AbbreviationNode} child
     * @param {Number} position Index in children array where child should 
     * be inserted
     * @return {AbbreviationNode}
     */
    addChild: function(child, position) {
      child = child || new AbbreviationNode;
      child.parent = this;
      
      if (_.isUndefined(position)) {
        this.children.push(child);
      } else {
        this.children.splice(position, 0, child);
      }
      
      return child;
    },
    
    /**
     * Creates a deep copy of current node
     * @returns {AbbreviationNode}
     */
    clone: function() {
      var node = new AbbreviationNode();
      var attrs = ['abbreviation', 'counter', '_name', '_text', 'repeatCount', 'hasImplicitRepeat', 'start', 'end', 'content', 'padding'];
      _.each(attrs, function(a) {
        node[a] = this[a];
      }, this);
      
      // clone attributes
      node._attributes = _.map(this._attributes, function(attr) {
        return _.clone(attr);
      });
      
      node._data = _.clone(this._data);
      
      // clone children
      node.children = _.map(this.children, function(child) {
        child = child.clone();
        child.parent = node;
        return child;
      });
      
      return node;
    },
    
    /**
     * Removes current node from parent‘s child list
     * @returns {AbbreviationNode} Current node itself
     */
    remove: function() {
      if (this.parent) {
        this.parent.children = _.without(this.parent.children, this);
      }
      
      return this;
    },
    
    /**
     * Replaces current node in parent‘s children list with passed nodes
     * @param {AbbreviationNode} node Replacement node or array of nodes
     */
    replace: function() {
      var parent = this.parent;
      var ix = _.indexOf(parent.children, this);
      var items = _.flatten(arguments);
      spliceFn.apply(parent.children, [ix, 1].concat(items));
      
      // update parent
      _.each(items, function(item) {
        item.parent = parent;
      });
    },
    
    /**
     * Recursively sets <code>property</code> to <code>value</code> of current
     * node and its children 
     * @param {String} name Property to update
     * @param {Object} value New property value
     */
    updateProperty: function(name, value) {
      this[name] = value;
      _.each(this.children, function(child) {
        child.updateProperty(name, value);
      });
      
      return this;
    },
    
    /**
     * Finds first child node that matches truth test for passed 
     * <code>fn</code> function
     * @param {Function} fn
     * @returns {AbbreviationNode}
     */
    find: function(fn) {
      return this.findAll(fn)[0];
//      if (!_.isFunction(fn)) {
//        var elemName = fn.toLowerCase();
//        fn = function(item) {return item.name().toLowerCase() == elemName;};
//      }
//      
//      var result = null;
//      _.find(this.children, function(child) {
//        if (fn(child)) {
//          return result = child;
//        }
//        
//        return result = child.find(fn);
//      });
//      
//      return result;
    },
    
    /**
     * Finds all child nodes that matches truth test for passed 
     * <code>fn</code> function
     * @param {Function} fn
     * @returns {Array}
     */
    findAll: function(fn) {
      if (!_.isFunction(fn)) {
        var elemName = fn.toLowerCase();
        fn = function(item) {return item.name().toLowerCase() == elemName;};
      }
        
      var result = [];
      _.each(this.children, function(child) {
        if (fn(child))
          result.push(child);
        
        result = result.concat(child.findAll(fn));
      });
      
      return _.compact(result);
    },
    
    /**
     * Sets/gets custom data
     * @param {String} name
     * @param {Object} value
     * @returns {Object}
     */
    data: function(name, value) {
      if (arguments.length == 2) {
        this._data[name] = value;
        
        if (name == 'resource' && require('elements').is(value, 'snippet')) {
          // setting snippet as matched resource: update `content`
          // property with snippet value
          this.content = value.data;
          if (this._text) {
            this.content = require('abbreviationUtils')
              .insertChildContent(value.data, this._text);
          }
        }
      }
      
      return this._data[name];
    },
    
    /**
     * Returns name of current node
     * @returns {String}
     */
    name: function() {
      var res = this.matchedResource();
      if (require('elements').is(res, 'element')) {
        return res.name;
      }
      
      return this._name;
    },
    
    /**
     * Returns list of attributes for current node
     * @returns {Array}
     */
    attributeList: function() {
      var attrs = [];
      
      var res = this.matchedResource();
      if (require('elements').is(res, 'element') && _.isArray(res.attributes)) {
        attrs = attrs.concat(res.attributes);
      }
      
      return optimizeAttributes(attrs.concat(this._attributes));
    },
    
    /**
     * Returns or sets attribute value
     * @param {String} name Attribute name
     * @param {String} value New attribute value
     * @returns {String}
     */
    attribute: function(name, value) {
      if (arguments.length == 2) {
        // modifying attribute
        var ix = _.indexOf(_.pluck(this._attributes, 'name'), name.toLowerCase());
        if (~ix) {
          this._attributes[ix].value = value;
        } else {
          this._attributes.push({
            name: name,
            value: value
          });
        }
      }
      
      return (_.find(this.attributeList(), function(attr) {
        return attr.name == name;
      }) || {}).value;
    },
    
    /**
     * Returns reference to the matched <code>element</code>, if any.
     * See {@link elements} module for a list of available elements
     * @returns {Object}
     */
    matchedResource: function() {
      return this.data('resource');
    },
    
    /**
     * Returns index of current node in parent‘s children list
     * @returns {Number}
     */
    index: function() {
      return this.parent ? _.indexOf(this.parent.children, this) : -1;
    },
    
    /**
     * Sets how many times current element should be repeated
     * @private
     */
    _setRepeat: function(count) {
      if (count) {
        this.repeatCount = parseInt(count, 10) || 1;
      } else {
        this.hasImplicitRepeat = true;
      }
    },
    
    /**
     * Sets abbreviation that belongs to current node
     * @param {String} abbr
     */
    setAbbreviation: function(abbr) {
      abbr = abbr || '';
      
      var that = this;
      
      // find multiplier
      abbr = abbr.replace(/\*(\d+)?$/, function(str, repeatCount) {
        that._setRepeat(repeatCount);
        return '';
      });
      
      this.abbreviation = abbr;
      
      var abbrText = extractText(abbr);
      if (abbrText) {
        abbr = abbrText.element;
        this.content = this._text = abbrText.text;
      }
      
      var abbrAttrs = parseAttributes(abbr);
      if (abbrAttrs) {
        abbr = abbrAttrs.element;
        this._attributes = abbrAttrs.attributes;
      }
      
      this._name = abbr;
      
      // validate name
      if (this._name && !reValidName.test(this._name)) {
        throw 'Invalid abbreviation';
      }
    },
    
    /**
     * Returns string representation of current node
     * @return {String}
     */
    toString: function() {
      var utils = require('utils');
      
      var start = this.start;
      var end = this.end;
      var content = this.content;
      
      // apply output processors
      var node = this;
      _.each(outputProcessors, function(fn) {
        start = fn(start, node, 'start');
        content = fn(content, node, 'content');
        end = fn(end, node, 'end');
      });
      
      
      var innerContent = _.map(this.children, function(child) {
        return child.toString();
      }).join('');
      
      content = require('abbreviationUtils').insertChildContent(content, innerContent, {
        keepVariable: false
      });
      
      return start + utils.padString(content, this.padding) + end;
    },
    
    /**
     * Check if current node contains children with empty <code>expr</code>
     * property
     * @return {Boolean}
     */
    hasEmptyChildren: function() {
      return !!_.find(this.children, function(child) {
        return child.isEmpty();
      });
    },
    
    /**
     * Check if current node has implied name that should be resolved
     * @returns {Boolean}
     */
    hasImplicitName: function() {
      return !this._name && !this.isTextNode();
    },
    
    /**
     * Indicates that current element is a grouping one, e.g. has no 
     * representation but serves as a container for other nodes
     * @returns {Boolean}
     */
    isGroup: function() {
      return !this.abbreviation;
    },
    
    /**
     * Indicates empty node (i.e. without abbreviation). It may be a 
     * grouping node and should not be outputted
     * @return {Boolean}
     */
    isEmpty: function() {
      return !this.abbreviation && !this.children.length;
    },
    
    /**
     * Indicates that current node should be repeated
     * @returns {Boolean}
     */
    isRepeating: function() {
      return this.repeatCount > 1 || this.hasImplicitRepeat;
    },
    
    /**
     * Check if current node is a text-only node
     * @return {Boolean}
     */
    isTextNode: function() {
      return !this.name() && !this.attributeList().length;
    },
    
    /**
     * Indicates whether this node may be used to build elements or snippets
     * @returns {Boolean}
     */
    isElement: function() {
      return !this.isEmpty() && !this.isTextNode();
    },
    
    /**
     * Returns latest and deepest child of current tree
     * @returns {AbbreviationNode}
     */
    deepestChild: function() {
      if (!this.children.length)
        return null;
        
      var deepestChild = this;
      while (deepestChild.children.length) {
        deepestChild = _.last(deepestChild.children);
      }
      
      return deepestChild;
    }
  };
  
  /**
   * Returns stripped string: a string without first and last character.
   * Used for “unquoting” strings
   * @param {String} str
   * @returns {String}
   */
  function stripped(str) {
    return str.substring(1, str.length - 1);
  }
  
  function consumeQuotedValue(stream, quote) {
    var ch;
    while (ch = stream.next()) {
      if (ch === quote)
        return true;
      
      if (ch == '\\')
        continue;
    }
    
    return false;
  }
  
  /**
   * Parses abbreviation into a tree
   * @param {String} abbr
   * @returns {AbbreviationNode}
   */
  function parseAbbreviation(abbr) {
    abbr = require('utils').trim(abbr);
    
    var root = new AbbreviationNode;
    var context = root.addChild(), ch;
    
    /** @type StringStream */
    var stream = require('stringStream').create(abbr);
    var loopProtector = 1000, multiplier;
    
    while (!stream.eol() && --loopProtector > 0) {
      ch = stream.peek();
      
      switch (ch) {
        case '(': // abbreviation group
          stream.start = stream.pos;
          if (stream.skipToPair('(', ')')) {
            var inner = parseAbbreviation(stripped(stream.current()));
            if (multiplier = stream.match(/^\*(\d+)?/, true)) {
              context._setRepeat(multiplier[1]);
            }
            
            _.each(inner.children, function(child) {
              context.addChild(child);
            });
          } else {
            throw 'Invalid abbreviation: mo matching ")" found for character at ' + stream.pos;
          }
          break;
          
        case '>': // child operator
          context = context.addChild();
          stream.next();
          break;
          
        case '+': // sibling operator
          context = context.parent.addChild();
          stream.next();
          break;
          
        case '^': // climb up operator
          var parent = context.parent || context;
          context = (parent.parent || parent).addChild();
          stream.next();
          break;
          
        default: // consume abbreviation
          stream.start = stream.pos;
          stream.eatWhile(function(c) {
            if (c == '[' || c == '{') {
              if (stream.skipToPair(c, pairs[c])) {
                stream.backUp(1);
                return true;
              }
              
              throw 'Invalid abbreviation: mo matching "' + pairs[c] + '" found for character at ' + stream.pos;
            }
            
            if (c == '+') {
              // let's see if this is an expando marker
              stream.next();
              var isMarker = stream.eol() ||  ~'+>^*'.indexOf(stream.peek());
              stream.backUp(1);
              return isMarker;
            }
            
            return c != '(' && isAllowedChar(c);
          });
          
          context.setAbbreviation(stream.current());
          stream.start = stream.pos;
      }
    }
    
    if (loopProtector < 1)
      throw 'Endless loop detected';
    
    return root;
  }
  
  /**
   * Extract attributes and their values from attribute set: 
   * <code>[attr col=3 title="Quoted string"]</code>
   * @param {String} attrSet
   * @returns {Array}
   */
  function extractAttributes(attrSet, attrs) {
    attrSet = require('utils').trim(attrSet);
    var result = [];
    
    /** @type StringStream */
    var stream = require('stringStream').create(attrSet);
    stream.eatSpace();
    
    while (!stream.eol()) {
      stream.start = stream.pos;
      if (stream.eatWhile(reWord)) {
        var attrName = stream.current();
        var attrValue = '';
        if (stream.peek() == '=') {
          stream.next();
          stream.start = stream.pos;
          var quote = stream.peek();
          
          if (quote == '"' || quote == "'") {
            stream.next();
            if (consumeQuotedValue(stream, quote)) {
              attrValue = stream.current();
              // strip quotes
              attrValue = attrValue.substring(1, attrValue.length - 1);
            } else {
              throw 'Invalid attribute value';
            }
          } else if (stream.eatWhile(/[^\s\]]/)) {
            attrValue = stream.current();
          } else {
            throw 'Invalid attribute value';
          }
        }
        
        result.push({
          name: attrName, 
          value: attrValue
        });
        stream.eatSpace();
      } else {
        break;
      }
    }
    
    return result;
  }
  
  /**
   * Parses tag attributes extracted from abbreviation. If attributes found, 
   * returns object with <code>element</code> and <code>attributes</code>
   * properties
   * @param {String} abbr
   * @returns {Object} Returns <code>null</code> if no attributes found in 
   * abbreviation
   */
  function parseAttributes(abbr) {
    /*
     * Example of incoming data:
     * #header
     * .some.data
     * .some.data#header
     * [attr]
     * #item[attr=Hello other="World"].class
     */
    var result = [];
    var attrMap = {'#': 'id', '.': 'class'};
    var nameEnd = null;
    
    /** @type StringStream */
    var stream = require('stringStream').create(abbr);
    while (!stream.eol()) {
      switch (stream.peek()) {
        case '#': // id
        case '.': // class
          if (nameEnd === null)
            nameEnd = stream.pos;
          
          var attrName = attrMap[stream.peek()];
          
          stream.next();
          stream.start = stream.pos;
          stream.eatWhile(reWord);
          result.push({
            name: attrName, 
            value: stream.current()
          });
          break;
        case '[': //begin attribute set
          if (nameEnd === null)
            nameEnd = stream.pos;
          
          stream.start = stream.pos;
          if (!stream.skipToPair('[', ']')) 
            throw 'Invalid attribute set definition';
          
          result = result.concat(
            extractAttributes(stripped(stream.current()))
          );
          break;
        default:
          stream.next();
      }
    }
    
    if (!result.length)
      return null;
    
    return {
      element: abbr.substring(0, nameEnd),
      attributes: optimizeAttributes(result)
    };
  }
  
  /**
   * Optimize attribute set: remove duplicates and merge class attributes
   * @param attrs
   */
  function optimizeAttributes(attrs) {
    // clone all attributes to make sure that original objects are 
    // not modified
    attrs  = _.map(attrs, function(attr) {
      return _.clone(attr);
    });
    
    var lookup = {};
    return _.filter(attrs, function(attr) {
      if (!(attr.name in lookup)) {
        return lookup[attr.name] = attr;
      }
      
      var la = lookup[attr.name];
      
      if (attr.name.toLowerCase() == 'class') {
        la.value += (la.value.length ? ' ' : '') + attr.value;
      } else {
        la.value = attr.value;
      }
      
      return false;
    });
  }
  
  /**
   * Extract text data from abbreviation: if <code>a{hello}</code> abbreviation
   * is passed, returns object <code>{element: 'a', text: 'hello'}</code>.
   * If nothing found, returns <code>null</code>
   * @param {String} abbr
   * 
   */
  function extractText(abbr) {
    if (!~abbr.indexOf('{'))
      return null;
    
    /** @type StringStream */
    var stream = require('stringStream').create(abbr);
    while (!stream.eol()) {
      switch (stream.peek()) {
        case '[':
        case '(':
          stream.skipToPair(stream.peek(), pairs[stream.peek()]); break;
          
        case '{':
          stream.start = stream.pos;
          stream.skipToPair('{', '}');
          return {
            element: abbr.substring(0, stream.start),
            text: stripped(stream.current())
          };
          
        default:
          stream.next();
      }
    }
  }
  
  /**
   * “Un-rolls“ contents of current node: recursively replaces all repeating 
   * children with their repeated clones
   * @param {AbbreviationNode} node
   * @returns {AbbreviationNode}
   */
  function unroll(node) {
    for (var i = node.children.length - 1, j, child, maxCount; i >= 0; i--) {
      child = node.children[i];
      
      if (child.isRepeating()) {
        maxCount = j = child.repeatCount;
        child.repeatCount = 1;
        child.updateProperty('counter', 1);
        child.updateProperty('maxCount', maxCount);
        while (--j > 0) {
          child.parent.addChild(child.clone(), i + 1)
            .updateProperty('counter', j + 1)
            .updateProperty('maxCount', maxCount);
        }
      }
    }
    
    // to keep proper 'counter' property, we need to walk
    // on children once again
    _.each(node.children, unroll);
    
    return node;
  }
  
  /**
   * Optimizes tree node: replaces empty nodes with their children
   * @param {AbbreviationNode} node
   * @return {AbbreviationNode}
   */
  function squash(node) {
    for (var i = node.children.length - 1; i >= 0; i--) {
      /** @type AbbreviationNode */
      var n = node.children[i];
      if (n.isGroup()) {
        n.replace(squash(n).children);
      } else if (n.isEmpty()) {
        n.remove();
      }
    }
    
    _.each(node.children, squash);
    
    return node;
  }
  
  function isAllowedChar(ch) {
    var charCode = ch.charCodeAt(0);
    var specialChars = '#.*:$-_!@|%';
    
    return (charCode > 64 && charCode < 91)       // uppercase letter
        || (charCode > 96 && charCode < 123)  // lowercase letter
        || (charCode > 47 && charCode < 58)   // number
        || specialChars.indexOf(ch) != -1;    // special character
  }
  
  // XXX add counter replacer function as output processor
  outputProcessors.push(function(text, node) {
    return require('utils').replaceCounter(text, node.counter, node.maxCount);
  });
  
  return {
    /**
     * Parses abbreviation into tree with respect of groups, 
     * text nodes and attributes. Each node of the tree is a single 
     * abbreviation. Tree represents actual structure of the outputted 
     * result
     * @memberOf abbreviationParser
     * @param {String} abbr Abbreviation to parse
     * @param {Object} options Additional options for parser and processors
     * 
     * @return {AbbreviationNode}
     */
    parse: function(abbr, options) {
      options = options || {};
      
      var tree = parseAbbreviation(abbr);
      
      if (options.contextNode) {
        // add info about context node –
        // a parent XHTML node in editor inside which abbreviation is 
        // expanded
        tree._name = options.contextNode.name;
        var attrLookup = {};
        _.each(tree._attributes, function(attr) {
          attrLookup[attr.name] = attr;
        });
        
        _.each(options.contextNode.attributes, function(attr) {
          if (attr.name in attrLookup) {
            attrLookup[attr.name].value = attr.value;
          } else {
            attr = _.clone(attr);
            tree._attributes.push(attr);
            attrLookup[attr.name] = attr;
          }
        });
      }
      
      
      // apply preprocessors
      _.each(preprocessors, function(fn) {
        fn(tree, options);
      });
      
      tree = squash(unroll(tree));
      
      // apply postprocessors
      _.each(postprocessors, function(fn) {
        fn(tree, options);
      });
      
      return tree;
    },
    
    AbbreviationNode: AbbreviationNode,
    
    /**
     * Add new abbreviation preprocessor. <i>Preprocessor</i> is a function
     * that applies to a parsed abbreviation tree right after it get parsed.
     * The passed tree is in unoptimized state.
     * @param {Function} fn Preprocessor function. This function receives
     * two arguments: parsed abbreviation tree (<code>AbbreviationNode</code>)
     * and <code>options</code> hash that was passed to <code>parse</code>
     * method
     */
    addPreprocessor: function(fn) {
      if (!_.include(preprocessors, fn))
        preprocessors.push(fn);
    },
    
    /**
     * Removes registered preprocessor
     */
    removeFilter: function(fn) {
      preprocessor = _.without(preprocessors, fn);
    },
    
    /**
     * Adds new abbreviation postprocessor. <i>Postprocessor</i> is a 
     * functinon that applies to <i>optimized</i> parsed abbreviation tree
     * right before it returns from <code>parse()</code> method
     * @param {Function} fn Postprocessor function. This function receives
     * two arguments: parsed abbreviation tree (<code>AbbreviationNode</code>)
     * and <code>options</code> hash that was passed to <code>parse</code>
     * method
     */
    addPostprocessor: function(fn) {
      if (!_.include(postprocessors, fn))
        postprocessors.push(fn);
    },
    
    /**
     * Removes registered postprocessor function
     */
    removePostprocessor: function(fn) {
      postprocessors = _.without(postprocessors, fn);
    },
    
    /**
     * Registers output postprocessor. <i>Output processor</i> is a 
     * function that applies to output part (<code>start</code>, 
     * <code>end</code> and <code>content</code>) when 
     * <code>AbbreviationNode.toString()</code> method is called
     */
    addOutputProcessor: function(fn) {
      if (!_.include(outputProcessors, fn))
        outputProcessors.push(fn);
    },
    
    /**
     * Removes registered output processor
     */
    removeOutputProcessor: function(fn) {
      outputProcessors = _.without(outputProcessors, fn);
    },
    
    /**
     * Check if passed symbol is valid symbol for abbreviation expression
     * @param {String} ch
     * @return {Boolean}
     */
    isAllowedChar: function(ch) {
      ch = String(ch); // convert Java object to JS
      return isAllowedChar(ch) || ~'>+^[](){}'.indexOf(ch);
    }
  };
});/**
 * Processor function that matches parsed <code>AbbreviationNode</code>
 * against resources defined in <code>resource</code> module
 * @param {Function} require
 * @param {Underscore} _
 */ 
emmet.exec(function(require, _) {
  /**
   * Finds matched resources for child nodes of passed <code>node</code> 
   * element. A matched resource is a reference to <i>snippets.json</i> entry
   * that describes output of parsed node 
   * @param {AbbreviationNode} node
   * @param {String} syntax
   */
  function matchResources(node, syntax) {
    var resources = require('resources');
    var elements = require('elements');
    var parser = require('abbreviationParser');
    
    // do a shallow copy because the children list can be modified during
    // resource matching
    _.each(_.clone(node.children), /** @param {AbbreviationNode} child */ function(child) {
      var r = resources.getMatchedResource(child, syntax);
      if (_.isString(r)) {
        child.data('resource', elements.create('snippet', r));
      } else if (elements.is(r, 'reference')) {
        // it’s a reference to another abbreviation:
        // parse it and insert instead of current child
        /** @type AbbreviationNode */
        var subtree = parser.parse(r.data, {
          syntax: syntax
        });
        
        // if context element should be repeated, check if we need to 
        // transfer repeated element to specific child node
        if (child.repeatCount > 1) {
          var repeatedChildren = subtree.findAll(function(node) {
            return node.hasImplicitRepeat;
          });
          
          _.each(repeatedChildren, function(node) {
            node.repeatCount = child.repeatCount;
            node.hasImplicitRepeat = false;
          });
        }
        
        // move child‘s children into the deepest child of new subtree
        var deepestChild = subtree.deepestChild();
        if (deepestChild) {
          _.each(child.children, function(c) {
            deepestChild.addChild(c);
          });
        }
        
        // copy current attributes to children
        _.each(subtree.children, function(node) {
          _.each(child.attributeList(), function(attr) {
            node.attribute(attr.name, attr.value);
          });
        });
        
        child.replace(subtree.children);
      } else {
        child.data('resource', r);
      }
      
      matchResources(child, syntax);
    });
  }
  
  // XXX register abbreviation filter that creates references to resources
  // on abbreviation nodes
  /**
   * @param {AbbreviationNode} tree
   */
  require('abbreviationParser').addPreprocessor(function(tree, options) {
    var syntax = options.syntax || emmet.defaultSyntax();
    matchResources(tree, syntax);
  });
  
});/**
 * Pasted content abbreviation processor. A pasted content is a content that
 * should be inserted into implicitly repeated abbreviation nodes.
 * This processor powers “Wrap With Abbreviation” action
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  var parser = require('abbreviationParser');
  var outputPlaceholder = '$#';
  
  /**
   * Locates output placeholders inside text
   * @param {String} text
   * @returns {Array} Array of ranges of output placeholder in text
   */
  function locateOutputPlaceholder(text) {
    var range = require('range');
    var result = [];
    
    /** @type StringStream */
    var stream = require('stringStream').create(text);
    
    while (!stream.eol()) {
      if (stream.peek() == '\\') {
        stream.next();
      } else {
        stream.start = stream.pos;
        if (stream.match(outputPlaceholder, true)) {
          result.push(range.create(stream.start, outputPlaceholder));
          continue;
        }
      }
      stream.next();
    }
    
    return result;
  }
  
  /**
   * Replaces output placeholders inside <code>source</code> with 
   * <code>value</code>
   * @param {String} source
   * @param {String} value
   * @returns {String}
   */
  function replaceOutputPlaceholders(source, value) {
    var utils = require('utils');
    var ranges = locateOutputPlaceholder(source);
    
    ranges.reverse();
    _.each(ranges, function(r) {
      source = utils.replaceSubstring(source, value, r);
    });
    
    return source;
  }
  
  /**
   * Check if parsed node contains output placeholder – a target where
   * pasted content should be inserted
   * @param {AbbreviationNode} node
   * @returns {Boolean}
   */
  function hasOutputPlaceholder(node) {
    if (locateOutputPlaceholder(node.content).length)
      return true;
    
    // check if attributes contains placeholder
    return !!_.find(node.attributeList(), function(attr) {
      return !!locateOutputPlaceholder(attr.value).length;
    });
  }
  
  /**
   * Insert pasted content into correct positions of parsed node
   * @param {AbbreviationNode} node
   * @param {String} content
   * @param {Boolean} overwrite Overwrite node content if no value placeholders
   * found instead of appending to existing content
   */
  function insertPastedContent(node, content, overwrite) {
    var nodesWithPlaceholders = node.findAll(function(item) {
      return hasOutputPlaceholder(item);
    });
    
    if (hasOutputPlaceholder(node))
      nodesWithPlaceholders.unshift(node);
    
    if (nodesWithPlaceholders.length) {
      _.each(nodesWithPlaceholders, function(item) {
        item.content = replaceOutputPlaceholders(item.content, content);
        _.each(item._attributes, function(attr) {
          attr.value = replaceOutputPlaceholders(attr.value, content);
        });
      });
    } else {
      // on output placeholders in subtree, insert content in the deepest
      // child node
      var deepest = node.deepestChild() || node;
      if (overwrite) {
        deepest.content = content;
      } else {
        deepest.content = require('abbreviationUtils').insertChildContent(deepest.content, content);
      }
    }
  }
  
  /**
   * @param {AbbreviationNode} tree
   * @param {Object} options
   */
  parser.addPreprocessor(function(tree, options) {
    if (options.pastedContent) {
      var utils = require('utils');
      var lines = _.map(utils.splitByLines(options.pastedContent, true), utils.trim);
      
      // set repeat count for implicitly repeated elements before
      // tree is unrolled
      tree.findAll(function(item) {
        if (item.hasImplicitRepeat) {
          item.data('paste', lines);
          return item.repeatCount = lines.length;
        }
      });
    }
  });
  
  /**
   * @param {AbbreviationNode} tree
   * @param {Object} options
   */
  parser.addPostprocessor(function(tree, options) {
    // for each node with pasted content, update text data
    var targets = tree.findAll(function(item) {
      var pastedContentObj = item.data('paste');
      var pastedContent = '';
      if (_.isArray(pastedContentObj)) {
        pastedContent = pastedContentObj[item.counter - 1];
      } else if (_.isFunction(pastedContentObj)) {
        pastedContent = pastedContentObj(item.counter - 1, item.content);
      } else if (pastedContentObj) {
        pastedContent = pastedContentObj;
      }
      
      if (pastedContent) {
        insertPastedContent(item, pastedContent, !!item.data('pasteOverwrites'));
      }
      
      item.data('paste', null);
      return !!pastedContentObj;
    });
    
    if (!targets.length && options.pastedContent) {
      // no implicitly repeated elements, put pasted content in
      // the deepest child
      insertPastedContent(tree, options.pastedContent);
    }
  });
});/**
 * Resolves tag names in abbreviations with implied name
 */
emmet.exec(function(require, _) {
  /**
   * Resolves implicit node names in parsed tree
   * @param {AbbreviationNode} tree
   */
  function resolveNodeNames(tree) {
    var tagName = require('tagName');
    _.each(tree.children, function(node) {
      if (node.hasImplicitName() || node.data('forceNameResolving')) {
        node._name = tagName.resolve(node.parent.name());
      }
      resolveNodeNames(node);
    });
    
    return tree;
  }
  
  require('abbreviationParser').addPostprocessor(resolveNodeNames);
});/**
 * @author Stoyan Stefanov
 * @link https://github.com/stoyan/etc/tree/master/cssex
 */

emmet.define('cssParser', function(require, _) {
var walker, tokens = [], isOp, isNameChar, isDigit;
    
    // walks around the source
    walker = {
        lines: null,
        total_lines: 0,
        linenum: -1,
        line: '',
        ch: '',
        chnum: -1,
        init: function (source) {
            var me = walker;
        
            // source, yumm
            me.lines = source
                .replace(/\r\n/g, '\n')
                .replace(/\r/g, '\n')
                .split('\n');
            me.total_lines = me.lines.length;
        
            // reset
            me.chnum = -1;
            me.linenum = -1;
            me.ch = '';
            me.line = '';
        
            // advance
            me.nextLine();
            me.nextChar();
        },
        nextLine: function () {
            var me = this;
            me.linenum += 1;
            if (me.total_lines <= me.linenum) {
                me.line = false;
            } else {
                me.line = me.lines[me.linenum];
            }
            if (me.chnum !== -1) {
                me.chnum = 0;
            }
            return me.line;
        }, 
        nextChar: function () {
            var me = this;
            me.chnum += 1;
            while (me.line.charAt(me.chnum) === '') {
                if (this.nextLine() === false) {
                    me.ch = false;
                    return false; // end of source
                }
                me.chnum = -1;
                me.ch = '\n';
                return '\n';
            }
            me.ch = me.line.charAt(me.chnum);
            return me.ch;
        },
        peek: function() {
            return this.line.charAt(this.chnum + 1);
        }
    };

    // utility helpers
    isNameChar = function (c) {
      // be more tolerate for name tokens: allow & character for LESS syntax
        return (c == '&' || c === '_' || c === '-' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));
    };

    isDigit = function (ch) {
        return (ch !== false && ch >= '0' && ch <= '9');
    };  

    isOp = (function () {
        var opsa = "{}[]()+*=.,;:>~|\\%$#@^!".split(''),
            opsmatcha = "*^|$~".split(''),
            ops = {},
            opsmatch = {},
            i = 0;
        for (; i < opsa.length; i += 1) {
            ops[opsa[i]] = true;
        }
        for (i = 0; i < opsmatcha.length; i += 1) {
            opsmatch[opsmatcha[i]] = true;
        }
        return function (ch, matchattr) {
            if (matchattr) {
                return !!opsmatch[ch];
            }
            return !!ops[ch];
        };
    }());
    
    // shorthands
    function isset(v) {
        return typeof v !== 'undefined';
    }
    function getConf() {
        return {
            'char': walker.chnum,
            line: walker.linenum
        };
    }


    // creates token objects and pushes them to a list
    function tokener(value, type, conf) {
        var w = walker, c = conf || {};
        tokens.push({
            charstart: isset(c['char']) ? c['char'] : w.chnum,
            charend:   isset(c.charend) ? c.charend : w.chnum,
            linestart: isset(c.line)    ? c.line    : w.linenum,
            lineend:   isset(c.lineend) ? c.lineend : w.linenum,
            value:     value,
            type:      type || value
        });
    }
    
    // oops
    function error(m, config) { 
        var w = walker,
            conf = config || {},
            c = isset(conf['char']) ? conf['char'] : w.chnum,
            l = isset(conf.line) ? conf.line : w.linenum;
        return {
            name: "ParseError",
            message: m + " at line " + (l + 1) + ' char ' + (c + 1),
            walker: w,
            tokens: tokens
        };
    }


    // token handlers follow for:
    // white space, comment, string, identifier, number, operator
    function white() {
    
        var c = walker.ch,
            token = '',
            conf = getConf();
    
        while (c === " " || c === "\t") {
            token += c;
            c = walker.nextChar();
        }
    
        tokener(token, 'white', conf);
    
    }

    function comment() {
    
        var w = walker,
            c = w.ch,
            token = c,
            cnext,
            conf = getConf();    
     
        cnext = w.nextChar();
        
        if (cnext !== '*') {
            // oops, not a comment, just a /
            conf.charend = conf['char'];
            conf.lineend = conf.line;
            return tokener(token, token, conf);
        }
    
        while (!(c === "*" && cnext === "/")) {
            token += cnext;
            c = cnext;
            cnext = w.nextChar();        
        }
        token += cnext;
        w.nextChar();
        tokener(token, 'comment', conf);
    }

    function str() {
        var w = walker,
            c = w.ch,
            q = c,
            token = c,
            cnext,
            conf = getConf();
    
        c = w.nextChar();
    
        while (c !== q) {
            
            if (c === '\n') {
                cnext = w.nextChar();
                if (cnext === "\\") {
                    token += c + cnext;
                } else {
                    // end of line with no \ escape = bad
                    throw error("Unterminated string", conf);
                }
            } else {
                if (c === "\\") {
                    token += c + w.nextChar();
                } else {
                    token += c;
                }
            }
        
            c = w.nextChar();
        
        }
        token += c;
        w.nextChar();
        tokener(token, 'string', conf);
    }
    
    function brace() {
        var w = walker,
            c = w.ch,
            depth = 0,
            token = c,
            conf = getConf();
    
        c = w.nextChar();
    
        while (c !== ')' && !depth) {
          if (c === '(') {
            depth++;
          } else if (c === ')') {
            depth--;
          } else if (c === false) {
            throw error("Unterminated brace", conf);
          }
          
          token += c;
            c = w.nextChar();
        }
        
        token += c;
        w.nextChar();
        tokener(token, 'brace', conf);
    }

    function identifier(pre) {
        var w = walker,
            c = w.ch,
            conf = getConf(),
            token = (pre) ? pre + c : c;
            
        c = w.nextChar();
    
        if (pre) { // adjust token position
          conf['char'] -= pre.length;
        }
        
        while (isNameChar(c) || isDigit(c)) {
            token += c;
            c = w.nextChar();
        }
    
        tokener(token, 'identifier', conf);    
    }

    function num() {
        var w = walker,
            c = w.ch,
            conf = getConf(),
            token = c,
            point = token === '.',
            nondigit;
        
        c = w.nextChar();
        nondigit = !isDigit(c);
    
        // .2px or .classname?
        if (point && nondigit) {
            // meh, NaN, could be a class name, so it's an operator for now
            conf.charend = conf['char'];
            conf.lineend = conf.line;
            return tokener(token, '.', conf);    
        }
        
        // -2px or -moz-something
        if (token === '-' && nondigit) {
            return identifier('-');
        }
    
        while (c !== false && (isDigit(c) || (!point && c === '.'))) { // not end of source && digit or first instance of .
            if (c === '.') {
                point = true;
            }
            token += c;
            c = w.nextChar();
        }

        tokener(token, 'number', conf);    
    
    }

    function op() {
        var w = walker,
            c = w.ch,
            conf = getConf(),
            token = c,
            next = w.nextChar();
            
        if (next === "=" && isOp(token, true)) {
            token += next;
            tokener(token, 'match', conf);
            w.nextChar();
            return;
        } 
        
        conf.charend = conf['char'] + 1;
        conf.lineend = conf.line;    
        tokener(token, token, conf);
    }


    // call the appropriate handler based on the first character in a token suspect
    function tokenize() {

        var ch = walker.ch;
    
        if (ch === " " || ch === "\t") {
            return white();
        }

        if (ch === '/') {
            return comment();
        } 

        if (ch === '"' || ch === "'") {
            return str();
        }
        
        if (ch === '(') {
            return brace();
        }
    
        if (ch === '-' || ch === '.' || isDigit(ch)) { // tricky - char: minus (-1px) or dash (-moz-stuff)
            return num();
        }
    
        if (isNameChar(ch)) {
            return identifier();
        }

        if (isOp(ch)) {
            return op();
        }
        
        if (ch === "\n") {
            tokener("line");
            walker.nextChar();
            return;
        }
        
        throw error("Unrecognized character");
    }
    
    /**
   * Returns newline character at specified position in content
   * @param {String} content
   * @param {Number} pos
   * @return {String}
   */
  function getNewline(content, pos) {
    return content.charAt(pos) == '\r' && content.charAt(pos + 1) == '\n' 
      ? '\r\n' 
      : content.charAt(pos);
  }

    return {
      /**
       * @param source
       * @returns
       * @memberOf emmet.cssParser
       */
        lex: function (source) {
            walker.init(source);
            tokens = [];
            while (walker.ch !== false) {
                tokenize();            
            }
            return tokens;
        },
        
        /**
         * Tokenizes CSS source
         * @param {String} source
         * @returns {Array}
         */
        parse: function(source) {
          // transform tokens
      var pos = 0;
      return _.map(this.lex(source), function(token) {
        if (token.type == 'line') {
          token.value = getNewline(source, pos);
        }
        
        return {
          type: token.type,
          start: pos,
          end: (pos += token.value.length)
        };
      });
    },
        
        toSource: function (toks) {
            var i = 0, max = toks.length, t, src = '';
            for (; i < max; i += 1) {
                t = toks[i];
                if (t.type === 'line') {
                    src += '\n';
                } else {
                    src += t.value;
                }
            }
            return src;
        }
    };
});/**
 * HTML tokenizer by Marijn Haverbeke
 * http://codemirror.net/
 * @constructor
 * @memberOf __xmlParseDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('xmlParser', function(require, _) {
  var Kludges = {
    autoSelfClosers : {},
    implicitlyClosed : {},
    contextGrabbers : {},
    doNotIndent : {},
    allowUnquoted : true,
    allowMissing : true
  };

  // Return variables for tokenizers
  var tagName = null, type = null;

  function inText(stream, state) {
    function chain(parser) {
      state.tokenize = parser;
      return parser(stream, state);
    }

    var ch = stream.next();
    if (ch == "<") {
      if (stream.eat("!")) {
        if (stream.eat("[")) {
          if (stream.match("CDATA["))
            return chain(inBlock("atom", "]]>"));
          else
            return null;
        } else if (stream.match("--"))
          return chain(inBlock("comment", "-->"));
        else if (stream.match("DOCTYPE", true, true)) {
          stream.eatWhile(/[\w\._\-]/);
          return chain(doctype(1));
        } else
          return null;
      } else if (stream.eat("?")) {
        stream.eatWhile(/[\w\._\-]/);
        state.tokenize = inBlock("meta", "?>");
        return "meta";
      } else {
        type = stream.eat("/") ? "closeTag" : "openTag";
        stream.eatSpace();
        tagName = "";
        var c;
        while ((c = stream.eat(/[^\s\u00a0=<>\"\'\/?]/)))
          tagName += c;
        state.tokenize = inTag;
        return "tag";
      }
    } else if (ch == "&") {
      var ok;
      if (stream.eat("#")) {
        if (stream.eat("x")) {
          ok = stream.eatWhile(/[a-fA-F\d]/) && stream.eat(";");
        } else {
          ok = stream.eatWhile(/[\d]/) && stream.eat(";");
        }
      } else {
        ok = stream.eatWhile(/[\w\.\-:]/) && stream.eat(";");
      }
      return ok ? "atom" : "error";
    } else {
      stream.eatWhile(/[^&<]/);
      return "text";
    }
  }

  function inTag(stream, state) {
    var ch = stream.next();
    if (ch == ">" || (ch == "/" && stream.eat(">"))) {
      state.tokenize = inText;
      type = ch == ">" ? "endTag" : "selfcloseTag";
      return "tag";
    } else if (ch == "=") {
      type = "equals";
      return null;
    } else if (/[\'\"]/.test(ch)) {
      state.tokenize = inAttribute(ch);
      return state.tokenize(stream, state);
    } else {
      stream.eatWhile(/[^\s\u00a0=<>\"\'\/?]/);
      return "word";
    }
  }

  function inAttribute(quote) {
    return function(stream, state) {
      while (!stream.eol()) {
        if (stream.next() == quote) {
          state.tokenize = inTag;
          break;
        }
      }
      return "string";
    };
  }

  function inBlock(style, terminator) {
    return function(stream, state) {
      while (!stream.eol()) {
        if (stream.match(terminator)) {
          state.tokenize = inText;
          break;
        }
        stream.next();
      }
      return style;
    };
  }
  
  function doctype(depth) {
    return function(stream, state) {
      var ch;
      while ((ch = stream.next()) != null) {
        if (ch == "<") {
          state.tokenize = doctype(depth + 1);
          return state.tokenize(stream, state);
        } else if (ch == ">") {
          if (depth == 1) {
            state.tokenize = inText;
            break;
          } else {
            state.tokenize = doctype(depth - 1);
            return state.tokenize(stream, state);
          }
        }
      }
      return "meta";
    };
  }

  var curState = null, setStyle;
  function pass() {
    for (var i = arguments.length - 1; i >= 0; i--)
      curState.cc.push(arguments[i]);
  }
  
  function cont() {
    pass.apply(null, arguments);
    return true;
  }

  function pushContext(tagName, startOfLine) {
    var noIndent = Kludges.doNotIndent.hasOwnProperty(tagName) 
      || (curState.context && curState.context.noIndent);
    curState.context = {
      prev : curState.context,
      tagName : tagName,
      indent : curState.indented,
      startOfLine : startOfLine,
      noIndent : noIndent
    };
  }
  
  function popContext() {
    if (curState.context)
      curState.context = curState.context.prev;
  }

  function element(type) {
    if (type == "openTag") {
      curState.tagName = tagName;
      return cont(attributes, endtag(curState.startOfLine));
    } else if (type == "closeTag") {
      var err = false;
      if (curState.context) {
        if (curState.context.tagName != tagName) {
          if (Kludges.implicitlyClosed.hasOwnProperty(curState.context.tagName.toLowerCase())) {
            popContext();
          }
          err = !curState.context || curState.context.tagName != tagName;
        }
      } else {
        err = true;
      }
      
      if (err)
        setStyle = "error";
      return cont(endclosetag(err));
    }
    return cont();
  }
  
  function endtag(startOfLine) {
    return function(type) {
      if (type == "selfcloseTag"
          || (type == "endTag" && Kludges.autoSelfClosers
              .hasOwnProperty(curState.tagName
                  .toLowerCase()))) {
        maybePopContext(curState.tagName.toLowerCase());
        return cont();
      }
      if (type == "endTag") {
        maybePopContext(curState.tagName.toLowerCase());
        pushContext(curState.tagName, startOfLine);
        return cont();
      }
      return cont();
    };
  }
  
  function endclosetag(err) {
    return function(type) {
      if (err)
        setStyle = "error";
      if (type == "endTag") {
        popContext();
        return cont();
      }
      setStyle = "error";
      return cont(arguments.callee);
    };
  }
  
  function maybePopContext(nextTagName) {
    var parentTagName;
    while (true) {
      if (!curState.context) {
        return;
      }
      parentTagName = curState.context.tagName.toLowerCase();
      if (!Kludges.contextGrabbers.hasOwnProperty(parentTagName)
          || !Kludges.contextGrabbers[parentTagName].hasOwnProperty(nextTagName)) {
        return;
      }
      popContext();
    }
  }

  function attributes(type) {
    if (type == "word") {
      setStyle = "attribute";
      return cont(attribute, attributes);
    }
    if (type == "endTag" || type == "selfcloseTag")
      return pass();
    setStyle = "error";
    return cont(attributes);
  }
  
  function attribute(type) {
    if (type == "equals")
      return cont(attvalue, attributes);
    if (!Kludges.allowMissing)
      setStyle = "error";
    return (type == "endTag" || type == "selfcloseTag") ? pass()
        : cont();
  }
  
  function attvalue(type) {
    if (type == "string")
      return cont(attvaluemaybe);
    if (type == "word" && Kludges.allowUnquoted) {
      setStyle = "string";
      return cont();
    }
    setStyle = "error";
    return (type == "endTag" || type == "selfCloseTag") ? pass()
        : cont();
  }
  
  function attvaluemaybe(type) {
    if (type == "string")
      return cont(attvaluemaybe);
    else
      return pass();
  }
  
  function startState() {
    return {
      tokenize : inText,
      cc : [],
      indented : 0,
      startOfLine : true,
      tagName : null,
      context : null
    };
  }
  
  function token(stream, state) {
    if (stream.sol()) {
      state.startOfLine = true;
      state.indented = 0;
    }
    
    if (stream.eatSpace())
      return null;

    setStyle = type = tagName = null;
    var style = state.tokenize(stream, state);
    state.type = type;
    if ((style || type) && style != "comment") {
      curState = state;
      while (true) {
        var comb = state.cc.pop() || element;
        if (comb(type || style))
          break;
      }
    }
    state.startOfLine = false;
    return setStyle || style;
  }

  return {
    /**
     * @memberOf emmet.xmlParser
     * @returns
     */
    parse: function(data, offset) {
      offset = offset || 0;
      var state = startState();
      var stream = require('stringStream').create(data);
      var tokens = [];
      while (!stream.eol()) {
        tokens.push({
          type: token(stream, state),
          start: stream.start + offset,
          end: stream.pos + offset
        });
        stream.start = stream.pos;
      }
      
      return tokens;
    }   
  };
});
/*
 * string_score.js: String Scoring Algorithm 0.1.10 
 *
 * http://joshaven.com/string_score
 * https://github.com/joshaven/string_score
 *
 * Copyright (C) 2009-2011 Joshaven Potter <yourtech@gmail.com>
 * Special thanks to all of the contributors listed here https://github.com/joshaven/string_score
 * MIT license: http://www.opensource.org/licenses/mit-license.php
 *
 * Date: Tue Mar 1 2011
*/

/**
 * Scores a string against another string.
 *  'Hello World'.score('he');     //=> 0.5931818181818181
 *  'Hello World'.score('Hello');  //=> 0.7318181818181818
 */
emmet.define('string-score', function(require, _) {
  return {
    score: function(string, abbreviation, fuzziness) {
      // If the string is equal to the abbreviation, perfect match.
        if (string == abbreviation) {return 1;}
        //if it's not a perfect match and is empty return 0
        if(abbreviation == "") {return 0;}

        var total_character_score = 0,
            abbreviation_length = abbreviation.length,
            string_length = string.length,
            start_of_string_bonus,
            abbreviation_score,
            fuzzies=1,
            final_score;
        
        // Walk through abbreviation and add up scores.
        for (var i = 0,
               character_score/* = 0*/,
               index_in_string/* = 0*/,
               c/* = ''*/,
               index_c_lowercase/* = 0*/,
               index_c_uppercase/* = 0*/,
               min_index/* = 0*/;
           i < abbreviation_length;
           ++i) {
          
          // Find the first case-insensitive match of a character.
          c = abbreviation.charAt(i);
          
          index_c_lowercase = string.indexOf(c.toLowerCase());
          index_c_uppercase = string.indexOf(c.toUpperCase());
          min_index = Math.min(index_c_lowercase, index_c_uppercase);
          index_in_string = (min_index > -1) ? min_index : Math.max(index_c_lowercase, index_c_uppercase);
          
          if (index_in_string === -1) { 
            if (fuzziness) {
              fuzzies += 1-fuzziness;
              continue;
            } else {
              return 0;
            }
          } else {
            character_score = 0.1;
          }
          
          // Set base score for matching 'c'.
          
          // Same case bonus.
          if (string[index_in_string] === c) { 
            character_score += 0.1; 
          }
          
          // Consecutive letter & start-of-string Bonus
          if (index_in_string === 0) {
            // Increase the score when matching first character of the remainder of the string
            character_score += 0.6;
            if (i === 0) {
              // If match is the first character of the string
              // & the first character of abbreviation, add a
              // start-of-string match bonus.
              start_of_string_bonus = 1; //true;
            }
          }
          else {
        // Acronym Bonus
        // Weighing Logic: Typing the first character of an acronym is as if you
        // preceded it with two perfect character matches.
        if (string.charAt(index_in_string - 1) === ' ') {
          character_score += 0.8; // * Math.min(index_in_string, 5); // Cap bonus at 0.4 * 5
        }
          }
          
          // Left trim the already matched part of the string
          // (forces sequential matching).
          string = string.substring(index_in_string + 1, string_length);
          
          total_character_score += character_score;
        } // end of for loop
        
        // Uncomment to weigh smaller words higher.
        // return total_character_score / string_length;
        
        abbreviation_score = total_character_score / abbreviation_length;
        //percentage_of_matched_string = abbreviation_length / string_length;
        //word_score = abbreviation_score * percentage_of_matched_string;
        
        // Reduce penalty for longer strings.
        //final_score = (word_score + abbreviation_score) / 2;
        final_score = ((abbreviation_score * (abbreviation_length / string_length)) + abbreviation_score) / 2;
        
        final_score = final_score / fuzzies;
        
        if (start_of_string_bonus && (final_score + 0.15 < 1)) {
          final_score += 0.15;
        }
        
        return final_score;
    }
  };
});/**
 * Utility module for Emmet
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('utils', function(require, _) {
  /** 
   * Special token used as a placeholder for caret positions inside 
   * generated output 
   */
  var caretPlaceholder = '${0}';
  
  /**
   * A simple string builder, optimized for faster text concatenation
   * @param {String} value Initial value
   */
  function StringBuilder(value) {
    this._data = [];
    this.length = 0;
    
    if (value)
      this.append(value);
  }
  
  StringBuilder.prototype = {
    /**
     * Append string
     * @param {String} text
     */
    append: function(text) {
      this._data.push(text);
      this.length += text.length;
    },
    
    /**
     * @returns {String}
     */
    toString: function() {
      return this._data.join('');
    },
    
    /**
     * @returns {String}
     */
    valueOf: function() {
      return this.toString();
    }
  };
  
  return {
    /** @memberOf utils */
    reTag: /<\/?[\w:\-]+(?:\s+[\w\-:]+(?:\s*=\s*(?:(?:"[^"]*")|(?:'[^']*')|[^>\s]+))?)*\s*(\/?)>$/,
    
    /**
     * Test if passed string ends with XHTML tag. This method is used for testing
     * '>' character: it belongs to tag or it's a part of abbreviation? 
     * @param {String} str
     * @return {Boolean}
     */
    endsWithTag: function(str) {
      return this.reTag.test(str);
    },
    
    /**
     * Check if passed symbol is a number
     * @param {String} ch
     * @returns {Boolean}
     */
    isNumeric: function(ch) {
      if (typeof(ch) == 'string')
        ch = ch.charCodeAt(0);
        
      return (ch && ch > 47 && ch < 58);
    },
    
    /**
     * Trim whitespace from string
     * @param {String} text
     * @return {String}
     */
    trim: function(text) {
      return (text || "").replace(/^\s+|\s+$/g, "");
    },
    
    /**
     * Returns newline character
     * @returns {String}
     */
    getNewline: function() {
      var res = require('resources');
      if (!res) {
        return '\n';
      }
      
      var nl = res.getVariable('newline');
      return _.isString(nl) ? nl : '\n';
    },
    
    /**
     * Sets new newline character that will be used in output
     * @param {String} str
     */
    setNewline: function(str) {
      var res = require('resources');
      res.setVariable('newline', str);
      res.setVariable('nl', str);
    },
    
    /**
     * Split text into lines. Set <code>remove_empty</code> to true to filter
     * empty lines
     * @param {String} text Text to split
     * @param {Boolean} removeEmpty Remove empty lines from result
     * @return {Array}
     */
    splitByLines: function(text, removeEmpty) {
      // IE fails to split string by regexp, 
      // need to normalize newlines first
      // Also, Mozilla's Rhiho JS engine has a weird newline bug
      var nl = this.getNewline();
      var lines = (text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n\r/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n/g, nl)
        .split(nl);
      
      if (removeEmpty) {
        lines = _.filter(lines, function(line) {
          return line.length && !!this.trim(line);
        }, this);
      }
      
      return lines;
    },
    
    /**
     * Normalizes newline character: replaces newlines in <code>text</code> 
     * with newline defined in preferences
     * @param {String} text
     * @returns {String}
     */
    normalizeNewline: function(text) {
      return this.splitByLines(text).join(this.getNewline());
    },
    
    /**
     * Repeats string <code>howMany</code> times
     * @param {String} str
     * @param {Number} how_many
     * @return {String}
     */
    repeatString: function(str, howMany) {
      var result = [];
      
      for (var i = 0; i < howMany; i++) 
        result.push(str);
        
      return result.join('');
    },
    
    /**
     * Returns list of paddings that should be used to align passed string
     * @param {Array} strings
     * @returns {Array}
     */
    getStringsPads: function(strings) {
      var lengths = _.map(strings, function(s) {
        return _.isString(s) ? s.length : +s;
      });
      
      var max = _.max(lengths);
      return _.map(lengths, function(l) {
        var pad = max - l;
        return pad ? this.repeatString(' ', pad) : '';
      }, this);
    },
    
    /**
     * Indents text with padding
     * @param {String} text Text to indent
     * @param {String} pad Padding size (number) or padding itself (string)
     * @return {String}
     */
    padString: function(text, pad) {
      var padStr = (_.isNumber(pad)) 
        ? this.repeatString(require('resources').getVariable('indentation') || '\t', pad) 
        : pad;
        
      var result = [];
      
      var lines = this.splitByLines(text);
      var nl = this.getNewline();
        
      result.push(lines[0]);
      for (var j = 1; j < lines.length; j++) 
        result.push(nl + padStr + lines[j]);
        
      return result.join('');
    },
    
    /**
     * Pad string with zeroes
     * @param {String} str String to pad
     * @param {Number} pad Desired string length
     * @return {String}
     */
    zeroPadString: function(str, pad) {
      var padding = '';
      var il = str.length;
        
      while (pad > il++) padding += '0';
      return padding + str; 
    },
    
    /**
     * Removes padding at the beginning of each text's line
     * @param {String} text
     * @param {String} pad
     */
    unindentString: function(text, pad) {
      var lines = this.splitByLines(text);
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].search(pad) == 0)
          lines[i] = lines[i].substr(pad.length);
      }
      
      return lines.join(this.getNewline());
    },
    
    /**
     * Replaces unescaped symbols in <code>str</code>. For example, the '$' symbol
     * will be replaced in 'item$count', but not in 'item\$count'.
     * @param {String} str Original string
     * @param {String} symbol Symbol to replace
     * @param {String} replace Symbol replacement. Might be a function that 
     * returns new value
     * @return {String}
     */
    replaceUnescapedSymbol: function(str, symbol, replace) {
      var i = 0;
      var il = str.length;
      var sl = symbol.length;
      var matchCount = 0;
        
      while (i < il) {
        if (str.charAt(i) == '\\') {
          // escaped symbol, skip next character
          i += sl + 1;
        } else if (str.substr(i, sl) == symbol) {
          // have match
          var curSl = sl;
          matchCount++;
          var newValue = replace;
          if (_.isFunction(replace)) {
            var replaceData = replace(str, symbol, i, matchCount);
            if (replaceData) {
              curSl = replaceData[0].length;
              newValue = replaceData[1];
            } else {
              newValue = false;
            }
          }
          
          if (newValue === false) { // skip replacement
            i++;
            continue;
          }
          
          str = str.substring(0, i) + newValue + str.substring(i + curSl);
          // adjust indexes
          il = str.length;
          i += newValue.length;
        } else {
          i++;
        }
      }
      
      return str;
    },
    
    /**
     * Replace variables like ${var} in string
     * @param {String} str
     * @param {Object} vars Variable set (defaults to variables defined in 
     * <code>snippets.json</code>) or variable resolver (<code>Function</code>)
     * @return {String}
     */
    replaceVariables: function(str, vars) {
      vars = vars || {};
      var resolver = _.isFunction(vars) ? vars : function(str, p1) {
        return p1 in vars ? vars[p1] : null;
      };
      
      var res = require('resources');
      return require('tabStops').processText(str, {
        variable: function(data) {
          var newValue = resolver(data.token, data.name, data);
          if (newValue === null) {
            // try to find variable in resources
            newValue = res.getVariable(data.name);
          }
          
          if (newValue === null || _.isUndefined(newValue))
            // nothing found, return token itself
            newValue = data.token;
          return newValue;
        }
      });
    },
    
    /**
     * Replaces '$' character in string assuming it might be escaped with '\'
     * @param {String} str String where character should be replaced
     * @param {String} value New value
     * @return {String}
     */
    replaceCounter: function(str, value, total) {
      var symbol = '$';
      // in case we received strings from Java, convert the to native strings
      str = String(str);
      value = String(value);
      
      if (/^\-?\d+$/.test(value)) {
        value = +value;
      }
      
      var that = this;
      
      return this.replaceUnescapedSymbol(str, symbol, function(str, symbol, pos, matchNum){
        if (str.charAt(pos + 1) == '{' || that.isNumeric(str.charAt(pos + 1)) ) {
          // it's a variable, skip it
          return false;
        }
        
        // replace sequense of $ symbols with padded number  
        var j = pos + 1;
        while(str.charAt(j) == '$' && str.charAt(j + 1) != '{') j++;
        var pad = j - pos;
        
        // get counter base
        var base = 0, decrement = false, m;
        if (m = str.substr(j).match(/^@(\-?)(\d*)/)) {
          j += m[0].length;
          
          if (m[1]) {
            decrement = true;
          }
          
          base = parseInt(m[2] || 1) - 1;
        }
        
        if (decrement && total && _.isNumber(value)) {
          value = total - value + 1;
        }
        
        value += base;
        
        return [str.substring(pos, j), that.zeroPadString(value + '', pad)];
      });
    },
    
    /**
     * Check if string matches against <code>reTag</code> regexp. This 
     * function may be used to test if provided string contains HTML tags
     * @param {String} str
     * @returns {Boolean}
     */
    matchesTag: function(str) {
      return this.reTag.test(str || '');
    },
    
    /**
     * Escapes special characters used in Emmet, like '$', '|', etc.
     * Use this method before passing to actions like "Wrap with Abbreviation"
     * to make sure that existing special characters won't be altered
     * @param {String} text
     * @return {String}
     */
    escapeText: function(text) {
      return text.replace(/([\$\\])/g, '\\$1');
    },
    
    /**
     * Unescapes special characters used in Emmet, like '$', '|', etc.
     * @param {String} text
     * @return {String}
     */
    unescapeText: function(text) {
      return text.replace(/\\(.)/g, '$1');
    },
    
    /**
     * Returns caret placeholder
     * @returns {String}
     */
    getCaretPlaceholder: function() {
      return _.isFunction(caretPlaceholder) 
        ? caretPlaceholder.apply(this, arguments)
        : caretPlaceholder;
    },
    
    /**
     * Sets new representation for carets in generated output
     * @param {String} value New caret placeholder. Might be a 
     * <code>Function</code>
     */
    setCaretPlaceholder: function(value) {
      caretPlaceholder = value;
    },
    
    /**
     * Returns line padding
     * @param {String} line
     * @return {String}
     */
    getLinePadding: function(line) {
      return (line.match(/^(\s+)/) || [''])[0];
    },
    
    /**
     * Helper function that returns padding of line of <code>pos</code>
     * position in <code>content</code>
     * @param {String} content
     * @param {Number} pos
     * @returns {String}
     */
    getLinePaddingFromPosition: function(content, pos) {
      var lineRange = this.findNewlineBounds(content, pos);
      return this.getLinePadding(lineRange.substring(content));
    },
    
    /**
     * Escape special regexp chars in string, making it usable for creating dynamic
     * regular expressions
     * @param {String} str
     * @return {String}
     */
    escapeForRegexp: function(str) {
      var specials = new RegExp("[.*+?|()\\[\\]{}\\\\]", "g"); // .*+?|()[]{}\
      return str.replace(specials, "\\$&");
    },
    
    /**
     * Make decimal number look good: convert it to fixed precision end remove
     * traling zeroes 
     * @param {Number} num
     * @param {Number} fracion Fraction numbers (default is 2)
     * @return {String}
     */
    prettifyNumber: function(num, fraction) {
      return num.toFixed(typeof fraction == 'undefined' ? 2 : fraction).replace(/\.?0+$/, '');
    },
    
    /**
     * A simple mutable string shim, optimized for faster text concatenation
     * @param {String} value Initial value
     * @returns {StringBuilder}
     */
    stringBuilder: function(value) {
      return new StringBuilder(value);
    },
    
    /**
     * Replace substring of <code>str</code> with <code>value</code>
     * @param {String} str String where to replace substring
     * @param {String} value New substring value
     * @param {Number} start Start index of substring to replace. May also
     * be a <code>Range</code> object: in this case, the <code>end</code>
     * argument is not required
     * @param {Number} end End index of substring to replace. If ommited, 
     * <code>start</code> argument is used
     */
    replaceSubstring: function(str, value, start, end) {
      if (_.isObject(start) && 'end' in start) {
        end = start.end;
        start = start.start;
      }
      
      if (_.isString(end))
        end = start + end.length;
      
      if (_.isUndefined(end))
        end = start;
      
      if (start < 0 || start > str.length)
        return str;
      
      return str.substring(0, start) + value + str.substring(end);
    },
    
    /**
     * Narrows down text range, adjusting selection to non-space characters
     * @param {String} text
     * @param {Number} start Starting range in <code>text</code> where 
     * slection should be adjusted. Can also be any object that is accepted
     * by <code>Range</code> class
     * @return {Range}
     */
    narrowToNonSpace: function(text, start, end) {
      var range = require('range').create(start, end);
      
      var reSpace = /[\s\n\r\u00a0]/;
      // narrow down selection until first non-space character
      while (range.start < range.end) {
        if (!reSpace.test(text.charAt(range.start)))
          break;
          
        range.start++;
      }
      
      while (range.end > range.start) {
        range.end--;
        if (!reSpace.test(text.charAt(range.end))) {
          range.end++;
          break;
        }
      }
      
      return range;
    },
    
    /**
     * Find start and end index of text line for <code>from</code> index
     * @param {String} text 
     * @param {Number} from
     */
    findNewlineBounds: function(text, from) {
      var len = text.length,
        start = 0,
        end = len - 1;
      
      // search left
      for (var i = from - 1; i > 0; i--) {
        var ch = text.charAt(i);
        if (ch == '\n' || ch == '\r') {
          start = i + 1;
          break;
        }
      }
      // search right
      for (var j = from; j < len; j++) {
        var ch = text.charAt(j);
        if (ch == '\n' || ch == '\r') {
          end = j;
          break;
        }
      }
      
      return require('range').create(start, end - start);
    },

    /**
     * Deep merge of two or more objects. Taken from jQuery.extend()
     */
    deepMerge: function() {
      var options, name, src, copy, copyIsArray, clone,
        target = arguments[0] || {},
        i = 1,
        length = arguments.length;


      // Handle case when target is a string or something (possible in deep copy)
      if (!_.isObject(target) && !_.isFunction(target)) {
        target = {};
      }

      for ( ; i < length; i++ ) {
        // Only deal with non-null/undefined values
        if ( (options = arguments[ i ]) != null ) {
          // Extend the base object
          for ( name in options ) {
            src = target[ name ];
            copy = options[ name ];

            // Prevent never-ending loop
            if ( target === copy ) {
              continue;
            }

            // Recurse if we're merging plain objects or arrays
            if ( copy && ( _.isObject(copy) || (copyIsArray = _.isArray(copy)) ) ) {
              if ( copyIsArray ) {
                copyIsArray = false;
                clone = src && _.isArray(src) ? src : [];

              } else {
                clone = src && _.isObject(src) ? src : {};
              }

              // Never move original objects, clone them
              target[ name ] = this.deepMerge(clone, copy );

            // Don't bring in undefined values
            } else if ( copy !== undefined ) {
              target[ name ] = copy;
            }
          }
        }
      }

      // Return the modified object
      return target;
    }
  };
});
/**
 * Helper module to work with ranges
 * @constructor
 * @memberOf __rangeDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('range', function(require, _) {
  function cmp(a, b, op) {
    switch (op) {
      case 'eq':
      case '==':
        return a === b;
      case 'lt':
      case '<':
        return a < b;
      case 'lte':
      case '<=':
        return a <= b;
      case 'gt':
      case '>':
        return a > b;
      case 'gte':
      case '>=':
        return a >= b;
    }
  }
  
  
  /**
   * @type Range
   * @constructor
   * @param {Object} start
   * @param {Number} len
   */
  function Range(start, len) {
    if (_.isObject(start) && 'start' in start) {
      // create range from object stub
      this.start = Math.min(start.start, start.end);
      this.end = Math.max(start.start, start.end);
    } else if (_.isArray(start)) {
      this.start = start[0];
      this.end = start[1];
    } else {
      len = _.isString(len) ? len.length : +len;
      this.start = start;
      this.end = start + len;
    }
  }
  
  Range.prototype = {
    length: function() {
      return Math.abs(this.end - this.start);
    },
    
    /**
     * Returns <code>true</code> if passed range is equals to current one
     * @param {Range} range
     * @returns {Boolean}
     */
    equal: function(range) {
      return this.cmp(range, 'eq', 'eq');
//      return this.start === range.start && this.end === range.end;
    },
    
    /**
     * Shifts indexes position with passed <code>delat</code>
     * @param {Number} delta
     * @returns {Range} range itself
     */
    shift: function(delta) {
      this.start += delta;
      this.end += delta;
      return this;
    },
    
    /**
     * Check if two ranges are overlapped
     * @param {Range} range
     * @returns {Boolean}
     */
    overlap: function(range) {
      return range.start <= this.end && range.end >= this.start;
    },
    
    /**
     * Finds intersection of two ranges
     * @param {Range} range
     * @returns {Range} <code>null</code> if ranges does not overlap
     */
    intersection: function(range) {
      if (this.overlap(range)) {
        var start = Math.max(range.start, this.start);
        var end = Math.min(range.end, this.end);
        return new Range(start, end - start);
      }
      
      return null;
    },
    
    /**
     * Returns the union of the thow ranges.
     * @param {Range} range
     * @returns {Range} <code>null</code> if ranges are not overlapped
     */
    union: function(range) {
      if (this.overlap(range)) {
        var start = Math.min(range.start, this.start);
        var end = Math.max(range.end, this.end);
        return new Range(start, end - start);
      }
      
      return null;
    },
    
    /**
     * Returns a Boolean value that indicates whether a specified position 
     * is in a given range.
     * @param {Number} loc
     */
    inside: function(loc) {
      return this.cmp(loc, 'lte', 'gt');
//      return this.start <= loc && this.end > loc;
    },
    
    /**
     * Returns a Boolean value that indicates whether a specified position 
     * is in a given range, but not equals bounds.
     * @param {Number} loc
     */
    contains: function(loc) {
      return this.cmp(loc, 'lt', 'gt');
    },
    
    /**
     * Check if current range completely includes specified one
     * @param {Range} r
     * @returns {Boolean} 
     */
    include: function(r) {
      return this.cmp(loc, 'lte', 'gte');
//      return this.start <= r.start && this.end >= r.end;
    },
    
    /**
     * Low-level comparision method
     * @param {Number} loc
     * @param {String} left Left comparison operator
     * @param {String} right Right comaprison operator
     */
    cmp: function(loc, left, right) {
      var a, b;
      if (loc instanceof Range) {
        a = loc.start;
        b = loc.end;
      } else {
        a = b = loc;
      }
      
      return cmp(this.start, a, left || '<=') && cmp(this.end, b, right || '>');
    },
    
    /**
     * Returns substring of specified <code>str</code> for current range
     * @param {String} str
     * @returns {String}
     */
    substring: function(str) {
      return this.length() > 0 
        ? str.substring(this.start, this.end) 
        : '';
    },
    
    /**
     * Creates copy of current range
     * @returns {Range}
     */
    clone: function() {
      return new Range(this.start, this.length());
    },
    
    /**
     * @returns {Array}
     */
    toArray: function() {
      return [this.start, this.end];
    },
    
    toString: function() {
      return '{' + this.start + ', ' + this.length() + '}';
    }
  };
  
  return {
    /**
     * Creates new range object instance
     * @param {Object} start Range start or array with 'start' and 'end'
     * as two first indexes or object with 'start' and 'end' properties
     * @param {Number} len Range length or string to produce range from
     * @returns {Range}
     * @memberOf emmet.range
     */
    create: function(start, len) {
      if (_.isUndefined(start) || start === null)
        return null;
      
      if (start instanceof Range)
        return start;
      
      if (_.isObject(start) && 'start' in start && 'end' in start) {
        len = start.end - start.start;
        start = start.start;
      }
        
      return new Range(start, len);
    },
    
    /**
     * <code>Range</code> object factory, the same as <code>this.create()</code>
     * but last argument represents end of range, not length
     * @returns {Range}
     */
    create2: function(start, end) {
      if (_.isNumber(start) && _.isNumber(end)) {
        end -= start;
      }
      
      return this.create(start, end);
    }
  };
});/**
 * Utility module that provides ordered storage of function handlers. 
 * Many Emmet modules' functionality can be extended/overridden by custom
 * function. This modules provides unified storage of handler functions, their 
 * management and execution
 * 
 * @constructor
 * @memberOf __handlerListDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('handlerList', function(require, _) {
  /**
   * @type HandlerList
   * @constructor
   */
  function HandlerList() {
    this._list = [];
  }
  
  HandlerList.prototype = {
    /**
     * Adds function handler
     * @param {Function} fn Handler
     * @param {Object} options Handler options. Possible values are:<br><br>
     * <b>order</b> : (<code>Number</code>) – order in handler list. Handlers
     * with higher order value will be executed earlier.
     */
    add: function(fn, options) {
      this._list.push(_.extend({order: 0}, options || {}, {fn: fn}));
    },
    
    /**
     * Removes handler from list
     * @param {Function} fn
     */
    remove: function(fn) {
      this._list = _.without(this._list, _.find(this._list, function(item) {
        return item.fn === fn;
      }));
    },
    
    /**
     * Returns ordered list of handlers. By default, handlers 
     * with the same <code>order</code> option returned in reverse order, 
     * i.e. the latter function was added into the handlers list, the higher 
     * it will be in the returned array 
     * @returns {Array}
     */
    list: function() {
      return _.sortBy(this._list, 'order').reverse();
    },
    
    /**
     * Returns ordered list of handler functions
     * @returns {Array}
     */
    listFn: function() {
      return _.pluck(this.list(), 'fn');
    },
    
    /**
     * Executes handler functions in their designated order. If function
     * returns <code>skipVal</code>, meaning that function was unable to 
     * handle passed <code>args</code>, the next function will be executed
     * and so on.
     * @param {Object} skipValue If function returns this value, execute 
     * next handler.
     * @param {Array} args Arguments to pass to handler function
     * @returns {Boolean} Whether any of registered handlers performed
     * successfully  
     */
    exec: function(skipValue, args) {
      args = args || [];
      var result = null;
      _.find(this.list(), function(h) {
        result = h.fn.apply(h, args);
        if (result !== skipValue)
          return true;
      });
      
      return result;
    }
  };
  
  return {
    /**
     * Factory method that produces <code>HandlerList</code> instance
     * @returns {HandlerList}
     * @memberOf handlerList
     */
    create: function() {
      return new HandlerList();
    }
  };
});/**
 * Helper class for convenient token iteration
 */
emmet.define('tokenIterator', function(require, _) {
  /**
   * @type TokenIterator
   * @param {Array} tokens
   * @type TokenIterator
   * @constructor
   */
  function TokenIterator(tokens) {
    /** @type Array */
    this.tokens = tokens;
    this._position = 0;
    this.reset();
  }
  
  TokenIterator.prototype = {
    next: function() {
      if (this.hasNext()) {
        var token = this.tokens[++this._i];
        this._position = token.start;
        return token;
      }
      
      return null;
    },
    
    current: function() {
      return this.tokens[this._i];
    },
    
    position: function() {
      return this._position;
    },
    
    hasNext: function() {
      return this._i < this._il - 1;
    },
    
    reset: function() {
      this._i = -1;
      this._il = this.tokens.length;
    },
    
    item: function() {
      return this.tokens[this._i];
    },
    
    itemNext: function() {
      return this.tokens[this._i + 1];
    },
    
    itemPrev: function() {
      return this.tokens[this._i - 1];
    },
    
    nextUntil: function(type, callback) {
      var token;
      var test = _.isString(type) 
        ? function(t){return t.type == type;} 
        : type;
      
      while (token = this.next()) {
        if (callback)
          callback.call(this, token);
        if (test.call(this, token))
          break;
      }
    }
  };
  
  return {
    create: function(tokens) {
      return new TokenIterator(tokens);
    }
  };
});/**
 * A trimmed version of CodeMirror's StringStream module for string parsing
 */
emmet.define('stringStream', function(require, _) {
  /**
   * @type StringStream
   * @constructor
   * @param {String} string
   */
  function StringStream(string) {
    this.pos = this.start = 0;
    this.string = string;
  }
  
  StringStream.prototype = {
    /**
     * Returns true only if the stream is at the end of the line.
     * @returns {Boolean}
     */
    eol: function() {
      return this.pos >= this.string.length;
    },
    
    /**
     * Returns true only if the stream is at the start of the line
     * @returns {Boolean}
     */
    sol: function() {
      return this.pos == 0;
    },
    
    /**
     * Returns the next character in the stream without advancing it. 
     * Will return <code>undefined</code> at the end of the line.
     * @returns {String}
     */
    peek: function() {
      return this.string.charAt(this.pos);
    },
    
    /**
     * Returns the next character in the stream and advances it.
     * Also returns <code>undefined</code> when no more characters are available.
     * @returns {String}
     */
    next: function() {
      if (this.pos < this.string.length)
        return this.string.charAt(this.pos++);
    },
    
    /**
     * match can be a character, a regular expression, or a function that
     * takes a character and returns a boolean. If the next character in the
     * stream 'matches' the given argument, it is consumed and returned.
     * Otherwise, undefined is returned.
     * @param {Object} match
     * @returns {String}
     */
    eat: function(match) {
      var ch = this.string.charAt(this.pos), ok;
      if (typeof match == "string")
        ok = ch == match;
      else
        ok = ch && (match.test ? match.test(ch) : match(ch));
      
      if (ok) {
        ++this.pos;
        return ch;
      }
    },
    
    /**
     * Repeatedly calls <code>eat</code> with the given argument, until it
     * fails. Returns <code>true</code> if any characters were eaten.
     * @param {Object} match
     * @returns {Boolean}
     */
    eatWhile: function(match) {
      var start = this.pos;
      while (this.eat(match)) {}
      return this.pos > start;
    },
    
    /**
     * Shortcut for <code>eatWhile</code> when matching white-space.
     * @returns {Boolean}
     */
    eatSpace: function() {
      var start = this.pos;
      while (/[\s\u00a0]/.test(this.string.charAt(this.pos)))
        ++this.pos;
      return this.pos > start;
    },
    
    /**
     * Moves the position to the end of the line.
     */
    skipToEnd: function() {
      this.pos = this.string.length;
    },
    
    /**
     * Skips to the next occurrence of the given character, if found on the
     * current line (doesn't advance the stream if the character does not
     * occur on the line). Returns true if the character was found.
     * @param {String} ch
     * @returns {Boolean}
     */
    skipTo: function(ch) {
      var found = this.string.indexOf(ch, this.pos);
      if (found > -1) {
        this.pos = found;
        return true;
      }
    },
    
    /**
     * Skips to <code>close</code> character which is pair to <code>open</code>
     * character, considering possible pair nesting. This function is used
     * to consume pair of characters, like opening and closing braces
     * @param {String} open
     * @param {String} close
     * @returns {Boolean} Returns <code>true</code> if pair was successfully
     * consumed
     */
    skipToPair: function(open, close) {
      var braceCount = 0, ch;
      var pos = this.pos, len = this.string.length;
      while (pos < len) {
        ch = this.string.charAt(pos++);
        if (ch == open) {
          braceCount++;
        } else if (ch == close) {
          braceCount--;
          if (braceCount < 1) {
            this.pos = pos;
            return true;
          }
        }
      }
      
      return false;
    },
    
    /**
     * Backs up the stream n characters. Backing it up further than the
     * start of the current token will cause things to break, so be careful.
     * @param {Number} n
     */
    backUp : function(n) {
      this.pos -= n;
    },
    
    /**
     * Act like a multi-character <code>eat</code>—if <code>consume</code> is true or
     * not given—or a look-ahead that doesn't update the stream position—if
     * it is false. <code>pattern</code> can be either a string or a
     * regular expression starting with ^. When it is a string,
     * <code>caseInsensitive</code> can be set to true to make the match
     * case-insensitive. When successfully matching a regular expression,
     * the returned value will be the array returned by <code>match</code>,
     * in case you need to extract matched groups.
     * 
     * @param {RegExp} pattern
     * @param {Boolean} consume
     * @param {Boolean} caseInsensitive
     * @returns
     */
    match: function(pattern, consume, caseInsensitive) {
      if (typeof pattern == "string") {
        var cased = caseInsensitive
          ? function(str) {return str.toLowerCase();}
          : function(str) {return str;};
        
        if (cased(this.string).indexOf(cased(pattern), this.pos) == this.pos) {
          if (consume !== false)
            this.pos += pattern.length;
          return true;
        }
      } else {
        var match = this.string.slice(this.pos).match(pattern);
        if (match && consume !== false)
          this.pos += match[0].length;
        return match;
      }
    },
    
    /**
     * Get the string between the start of the current token and the 
     * current stream position.
     * @returns {String}
     */
    current: function() {
      return this.string.slice(this.start, this.pos);
    }
  };
  
  return {
    create: function(string) {
      return new StringStream(string);
    }
  };
});/**
 * Parsed resources (snippets, abbreviations, variables, etc.) for Emmet.
 * Contains convenient method to get access for snippets with respect of 
 * inheritance. Also provides ability to store data in different vocabularies
 * ('system' and 'user') for fast and safe resource update
 * @author Sergey Chikuyonok (serge.che@gmail.com)
 * @link http://chikuyonok.ru
 * 
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('resources', function(require, _) {
  var VOC_SYSTEM = 'system';
  var VOC_USER = 'user';
  
  var cache = {};
    
  /** Regular expression for XML tag matching */
  var reTag = /^<(\w+\:?[\w\-]*)((?:\s+[\w\:\-]+\s*=\s*(['"]).*?\3)*)\s*(\/?)>/;
    
  var systemSettings = {};
  var userSettings = {};
  
  /** @type HandlerList List of registered abbreviation resolvers */
  var resolvers = require('handlerList').create();
  
  /**
   * Normalizes caret plceholder in passed text: replaces | character with
   * default caret placeholder
   * @param {String} text
   * @returns {String}
   */
  function normalizeCaretPlaceholder(text) {
    var utils = require('utils');
    return utils.replaceUnescapedSymbol(text, '|', utils.getCaretPlaceholder());
  }
  
  function parseItem(name, value, type) {
    value = normalizeCaretPlaceholder(value);
    
    if (type == 'snippets') {
      return require('elements').create('snippet', value);
    }
    
    if (type == 'abbreviations') {
      return parseAbbreviation(name, value);
    }
  }
  
  /**
   * Parses single abbreviation
   * @param {String} key Abbreviation name
   * @param {String} value Abbreviation value
   * @return {Object}
   */
  function parseAbbreviation(key, value) {
    key = require('utils').trim(key);
    var elements = require('elements');
    var m;
    if (m = reTag.exec(value)) {
      return elements.create('element', m[1], m[2], m[4] == '/');
    } else {
      // assume it's reference to another abbreviation
      return elements.create('reference', value);
    }
  }
  
  /**
   * Normalizes snippet key name for better fuzzy search
   * @param {String} str
   * @returns {String}
   */
  function normalizeName(str) {
    return str.replace(/:$/, '').replace(/:/g, '-');
  }
  
  return {
    /**
     * Sets new unparsed data for specified settings vocabulary
     * @param {Object} data
     * @param {String} type Vocabulary type ('system' or 'user')
     * @memberOf resources
     */
    setVocabulary: function(data, type) {
      cache = {};
      if (type == VOC_SYSTEM)
        systemSettings = data;
      else
        userSettings = data;
    },
    
    /**
     * Returns resource vocabulary by its name
     * @param {String} name Vocabulary name ('system' or 'user')
     * @return {Object}
     */
    getVocabulary: function(name) {
      return name == VOC_SYSTEM ? systemSettings : userSettings;
    },
    
    /**
     * Returns resource (abbreviation, snippet, etc.) matched for passed 
     * abbreviation
     * @param {TreeNode} node
     * @param {String} syntax
     * @returns {Object}
     */
    getMatchedResource: function(node, syntax) {
      return resolvers.exec(null, _.toArray(arguments)) 
        || this.findSnippet(syntax, node.name());
    },
    
    /**
     * Returns variable value
     * @return {String}
     */
    getVariable: function(name) {
      return (this.getSection('variables') || {})[name];
    },
    
    /**
     * Store runtime variable in user storage
     * @param {String} name Variable name
     * @param {String} value Variable value
     */
    setVariable: function(name, value){
      var voc = this.getVocabulary('user') || {};
      if (!('variables' in voc))
        voc.variables = {};
        
      voc.variables[name] = value;
      this.setVocabulary(voc, 'user');
    },
    
    /**
     * Check if there are resources for specified syntax
     * @param {String} syntax
     * @return {Boolean}
     */
    hasSyntax: function(syntax) {
      return syntax in this.getVocabulary(VOC_USER) 
        || syntax in this.getVocabulary(VOC_SYSTEM);
    },
    
    /**
     * Registers new abbreviation resolver.
     * @param {Function} fn Abbreviation resolver which will receive 
     * abbreviation as first argument and should return parsed abbreviation
     * object if abbreviation has handled successfully, <code>null</code>
     * otherwise
     * @param {Object} options Options list as described in 
     * {@link HandlerList#add()} method
     */
    addResolver: function(fn, options) {
      resolvers.add(fn, options);
    },
    
    removeResolver: function(fn) {
      resolvers.remove(fn);
    },
    
    /**
     * Returns actual section data, merged from both
     * system and user data
     * @param {String} name Section name (syntax)
     * @param {String} ...args Subsections
     * @returns
     */
    getSection: function(name) {
      if (!name)
        return null;
      
      if (!(name in cache)) {
        cache[name] = require('utils').deepMerge({}, systemSettings[name], userSettings[name]);
      }
      
      var data = cache[name], subsections = _.rest(arguments), key;
      while (data && (key = subsections.shift())) {
        if (key in data) {
          data = data[key];
        } else {
          return null;
        }
      }
      
      return data;
    },
    
    /**
     * Recursively searches for a item inside top level sections (syntaxes)
     * with respect of `extends` attribute
     * @param {String} topSection Top section name (syntax)
     * @param {String} subsection Inner section name
     * @returns {Object}
     */
    findItem: function(topSection, subsection) {
      var data = this.getSection(topSection);
      while (data) {
        if (subsection in data)
          return data[subsection];
        
        data = this.getSection(data['extends']);
      }
    },
    
    /**
     * Recursively searches for a snippet definition inside syntax section.
     * Definition is searched inside `snippets` and `abbreviations` 
     * subsections  
     * @param {String} syntax Top-level section name (syntax)
     * @param {String} name Snippet name
     * @returns {Object}
     */
    findSnippet: function(syntax, name, memo) {
      if (!syntax || !name)
        return null;
      
      memo = memo || [];
      
      var names = [name];
      // create automatic aliases to properties with colons,
      // e.g. pos-a == pos:a
      if (~name.indexOf('-'))
        names.push(name.replace(/\-/g, ':'));
      
      var data = this.getSection(syntax), matchedItem = null;
      _.find(['snippets', 'abbreviations'], function(sectionName) {
        var data = this.getSection(syntax, sectionName);
        if (data) {
          return _.find(names, function(n) {
            if (data[n])
              return matchedItem = parseItem(n, data[n], sectionName);
          });
        }
      }, this);
      
      memo.push(syntax);
      if (!matchedItem && data['extends'] && !_.include(memo, data['extends'])) {
        // try to find item in parent syntax section
        return this.findSnippet(data['extends'], name, memo);
      }
      
      return matchedItem;
    },
    
    /**
     * Performs fuzzy search of snippet definition
     * @param {String} syntax Top-level section name (syntax)
     * @param {String} name Snippet name
     * @returns
     */
    fuzzyFindSnippet: function(syntax, name, minScore) {
      minScore = minScore || 0.3;
      
      var payload = this.getAllSnippets(syntax);
      var sc = require('string-score');
      
      name = normalizeName(name);
      var scores = _.map(payload, function(value, key) {
        return {
          key: key,
          score: sc.score(value.nk, name, 0.1)
        };
      });
      
      var result = _.last(_.sortBy(scores, 'score'));
      if (result && result.score >= minScore) {
        var k = result.key;
        return payload[k].parsedValue;
//        return parseItem(k, payload[k].value, payload[k].type);
      }
    },
    
    /**
     * Returns plain dictionary of all available abbreviations and snippets
     * for specified syntax with respect of inheritance
     * @param {String} syntax
     * @returns {Object}
     */
    getAllSnippets: function(syntax) {
      var cacheKey = 'all-' + syntax;
      if (!cache[cacheKey]) {
        var stack = [], sectionKey = syntax;
        var memo = [];
        
        do {
          var section = this.getSection(sectionKey);
          if (!section)
            break;
          
          _.each(['snippets', 'abbreviations'], function(sectionName) {
            var stackItem = {};
            _.each(section[sectionName] || null, function(v, k) {
              stackItem[k] = {
                nk: normalizeName(k),
                value: v,
                parsedValue: parseItem(k, v, sectionName),
                type: sectionName
              };
            });
            
            stack.push(stackItem);
          });
          
          memo.push(sectionKey);
          sectionKey = section['extends'];
        } while (sectionKey && !_.include(memo, sectionKey));
        
        
        cache[cacheKey] = _.extend.apply(_, stack.reverse());
      }
      
      return cache[cacheKey];
    }
  };
});/**
 * Module describes and performs Emmet actions. The actions themselves are
 * defined in <i>actions</i> folder
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('actions', function(require, _, zc) {
  var actions = {};
  
  /**
   * “Humanizes” action name, makes it more readable for people
   * @param {String} name Action name (like 'expand_abbreviation')
   * @return Humanized name (like 'Expand Abbreviation')
   */
  function humanizeActionName(name) {
    return require('utils').trim(name.charAt(0).toUpperCase() 
      + name.substring(1).replace(/_[a-z]/g, function(str) {
        return ' ' + str.charAt(1).toUpperCase();
      }));
  }
  
  return {
    /**
     * Registers new action
     * @param {String} name Action name
     * @param {Function} fn Action function
     * @param {Object} options Custom action options:<br>
     * <b>label</b> : (<code>String</code>) – Human-readable action name. 
     * May contain '/' symbols as submenu separators<br>
     * <b>hidden</b> : (<code>Boolean</code>) – Indicates whether action
     * should be displayed in menu (<code>getMenu()</code> method)
     * 
     * @memberOf actions
     */
    add: function(name, fn, options) {
      name = name.toLowerCase();
      options = options || {};
      if (!options.label) {
        options.label = humanizeActionName(name);
      }
      
      actions[name] = {
        name: name,
        fn: fn,
        options: options
      };
    },
    
    /**
     * Returns action object
     * @param {String} name Action name
     * @returns {Object}
     */
    get: function(name) {
      return actions[name.toLowerCase()];
    },
    
    /**
     * Runs Emmet action. For list of available actions and their
     * arguments see <i>actions</i> folder.
     * @param {String} name Action name 
     * @param {Array} args Additional arguments. It may be array of arguments
     * or inline arguments. The first argument should be <code>IEmmetEditor</code> instance
     * @returns {Boolean} Status of performed operation, <code>true</code>
     * means action was performed successfully.
     * @example
     * emmet.require('actions').run('expand_abbreviation', editor);  
     * emmet.require('actions').run('wrap_with_abbreviation', [editor, 'div']);  
     */
    run: function(name, args) {
      if (!_.isArray(args)) {
        args = _.rest(arguments);
      }
      
      var action = this.get(name);
      if (action) {
        return action.fn.apply(emmet, args);
      } else {
        emmet.log('Action "%s" is not defined', name);
        return false;
      }
    },
    
    /**
     * Returns all registered actions as object
     * @returns {Object}
     */
    getAll: function() {
      return actions;
    },
    
    /**
     * Returns all registered actions as array
     * @returns {Array}
     */
    getList: function() {
      return _.values(this.getAll());
    },
    
    /**
     * Returns actions list as structured menu. If action has <i>label</i>,
     * it will be splitted by '/' symbol into submenus (for example: 
     * CSS/Reflect Value) and grouped with other items
     * @param {Array} skipActions List of action identifiers that should be 
     * skipped from menu
     * @returns {Array}
     */
    getMenu: function(skipActions) {
      var result = [];
      skipActions = skipActions || [];
      _.each(this.getList(), function(action) {
        if (action.options.hidden || _.include(skipActions, action.name))
          return;
        
        var actionName = humanizeActionName(action.name);
        var ctx = result;
        if (action.options.label) {
          var parts = action.options.label.split('/');
          actionName = parts.pop();
          
          // create submenus, if needed
          var menuName, submenu;
          while (menuName = parts.shift()) {
            submenu = _.find(ctx, function(item) {
              return item.type == 'submenu' && item.name == menuName;
            });
            
            if (!submenu) {
              submenu = {
                name: menuName,
                type: 'submenu',
                items: []
              };
              ctx.push(submenu);
            }
            
            ctx = submenu.items;
          }
        }
        
        ctx.push({
          type: 'action',
          name: action.name,
          label: actionName
        });
      });
      
      return result;
    },

    /**
     * Returns action name associated with menu item title
     * @param {String} title
     * @returns {String}
     */
    getActionNameForMenuTitle: function(title, menu) {
      var item = null;
      _.find(menu || this.getMenu(), function(val) {
        if (val.type == 'action') {
          if (val.label == title || val.name == title) {
            return item = val.name;
          }
        } else {
          return item = this.getActionNameForMenuTitle(title, val.items);
        }
      }, this);
      
      return item || null;
    }
  };
});/**
 * Output profile module.
 * Profile defines how XHTML output data should look like
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('profile', function(require, _) {
  var profiles = {};
  
  var defaultProfile = {
    tag_case: 'asis',
    attr_case: 'asis',
    attr_quotes: 'double',
    
    // each tag on new line
    tag_nl: 'decide',
    
    // with tag_nl === true, defines if leaf node (e.g. node with no children)
    // should have formatted line breaks
    tag_nl_leaf: false,
    
    place_cursor: true,
    
    // indent tags
    indent: true,
    
    // how many inline elements should be to force line break 
    // (set to 0 to disable)
    inline_break: 3,
    
    // use self-closing style for writing empty elements, e.g. <br /> or <br>
    self_closing_tag: 'xhtml',
    
    // Profile-level output filters, re-defines syntax filters 
    filters: '',
    
    // Additional filters applied to abbreviation.
    // Unlike "filters", this preference doesn't override default filters
    // but add the instead every time given profile is chosen
    extraFilters: ''
  };
  
  /**
   * @constructor
   * @type OutputProfile
   * @param {Object} options
   */
  function OutputProfile(options) {
    _.extend(this, defaultProfile, options);
  }
  
  OutputProfile.prototype = {
    /**
     * Transforms tag name case depending on current profile settings
     * @param {String} name String to transform
     * @returns {String}
     */
    tagName: function(name) {
      return stringCase(name, this.tag_case);
    },
    
    /**
     * Transforms attribute name case depending on current profile settings 
     * @param {String} name String to transform
     * @returns {String}
     */
    attributeName: function(name) {
      return stringCase(name, this.attr_case);
    },
    
    /**
     * Returns quote character for current profile
     * @returns {String}
     */
    attributeQuote: function() {
      return this.attr_quotes == 'single' ? "'" : '"';
    },
    
    /**
     * Returns self-closing tag symbol for current profile
     * @param {String} param
     * @returns {String}
     */
    selfClosing: function(param) {
      if (this.self_closing_tag == 'xhtml')
        return ' /';
      
      if (this.self_closing_tag === true)
        return '/';
      
      return '';
    },
    
    /**
     * Returns cursor token based on current profile settings
     * @returns {String}
     */
    cursor: function() {
      return this.place_cursor ? require('utils').getCaretPlaceholder() : '';
    }
  };
  
  /**
   * Helper function that converts string case depending on 
   * <code>caseValue</code> 
   * @param {String} str String to transform
   * @param {String} caseValue Case value: can be <i>lower</i>, 
   * <i>upper</i> and <i>leave</i>
   * @returns {String}
   */
  function stringCase(str, caseValue) {
    switch (String(caseValue || '').toLowerCase()) {
      case 'lower':
        return str.toLowerCase();
      case 'upper':
        return str.toUpperCase();
    }
    
    return str;
  }
  
  /**
   * Creates new output profile
   * @param {String} name Profile name
   * @param {Object} options Profile options
   */
  function createProfile(name, options) {
    return profiles[name.toLowerCase()] = new OutputProfile(options);
  }
  
  function createDefaultProfiles() {
    createProfile('xhtml');
    createProfile('html', {self_closing_tag: false});
    createProfile('xml', {self_closing_tag: true, tag_nl: true});
    createProfile('plain', {tag_nl: false, indent: false, place_cursor: false});
    createProfile('line', {tag_nl: false, indent: false, extraFilters: 's'});
  }
  
  createDefaultProfiles();
  
  return  {
    /**
     * Creates new output profile and adds it into internal dictionary
     * @param {String} name Profile name
     * @param {Object} options Profile options
     * @memberOf emmet.profile
     * @returns {Object} New profile
     */
    create: function(name, options) {
      if (arguments.length == 2)
        return createProfile(name, options);
      else
        // create profile object only
        return new OutputProfile(_.defaults(name || {}, defaultProfile));
    },
    
    /**
     * Returns profile by its name. If profile wasn't found, returns
     * 'plain' profile
     * @param {String} name Profile name. Might be profile itself
     * @param {String} syntax. Optional. Current editor syntax. If defined,
     * profile is searched in resources first, then in predefined profiles
     * @returns {Object}
     */
    get: function(name, syntax) {
      if (!name && syntax) {
        // search in user resources first
        var profile = require('resources').findItem(syntax, 'profile');
        if (profile) {
          name = profile;
        }
      }
      
      if (!name) {
        return profiles.plain;
      }
      
      if (name instanceof OutputProfile) {
        return name;
      }
      
      if (_.isString(name) && name.toLowerCase() in profiles) {
        return profiles[name.toLowerCase()];
      }
      
      return this.create(name);
    },
    
    /**
     * Deletes profile with specified name
     * @param {String} name Profile name
     */
    remove: function(name) {
      name = (name || '').toLowerCase();
      if (name in profiles)
        delete profiles[name];
    },
    
    /**
     * Resets all user-defined profiles
     */
    reset: function() {
      profiles = {};
      createDefaultProfiles();
    },
    
    /**
     * Helper function that converts string case depending on 
     * <code>caseValue</code> 
     * @param {String} str String to transform
     * @param {String} caseValue Case value: can be <i>lower</i>, 
     * <i>upper</i> and <i>leave</i>
     * @returns {String}
     */
    stringCase: stringCase
  };
});/**
 * Utility module used to prepare text for pasting into back-end editor
 * @param {Function} require
 * @param {Underscore} _
 * @author Sergey Chikuyonok (serge.che@gmail.com) <http://chikuyonok.ru>
 */
emmet.define('editorUtils', function(require, _) {
  return  {
    /**
     * Check if cursor is placed inside XHTML tag
     * @param {String} html Contents of the document
     * @param {Number} caretPos Current caret position inside tag
     * @return {Boolean}
     */
    isInsideTag: function(html, caretPos) {
      var reTag = /^<\/?\w[\w\:\-]*.*?>/;
      
      // search left to find opening brace
      var pos = caretPos;
      while (pos > -1) {
        if (html.charAt(pos) == '<') 
          break;
        pos--;
      }
      
      if (pos != -1) {
        var m = reTag.exec(html.substring(pos));
        if (m && caretPos > pos && caretPos < pos + m[0].length)
          return true;
      }
      
      return false;
    },
    
    /**
     * Sanitizes incoming editor data and provides default values for
     * output-specific info
     * @param {IEmmetEditor} editor
     * @param {String} syntax
     * @param {String} profile
     */
    outputInfo: function(editor, syntax, profile) {
      // most of this code makes sense for Java/Rhino environment
      // because string that comes from Java are not actually JS string
      // but Java String object so the have to be explicitly converted
      // to native string
      profile = profile || editor.getProfileName();
      return  {
        /** @memberOf outputInfo */
        syntax: String(syntax || editor.getSyntax()),
        profile: profile ? String(profile) : null,
        content: String(editor.getContent())
      };
    },
    
    /**
     * Unindent content, thus preparing text for tag wrapping
     * @param {IEmmetEditor} editor Editor instance
     * @param {String} text
     * @return {String}
     */
    unindent: function(editor, text) {
      return require('utils').unindentString(text, this.getCurrentLinePadding(editor));
    },
    
    /**
     * Returns padding of current editor's line
     * @param {IEmmetEditor} Editor instance
     * @return {String}
     */
    getCurrentLinePadding: function(editor) {
      return require('utils').getLinePadding(editor.getCurrentLine());
    }
  };
});
/**
 * Utility methods for Emmet actions
 * @param {Function} require
 * @param {Underscore} _
 * @author Sergey Chikuyonok (serge.che@gmail.com) <http://chikuyonok.ru>
 */
emmet.define('actionUtils', function(require, _) {
  return {
    mimeTypes: {
      'gif' : 'image/gif',
      'png' : 'image/png',
      'jpg' : 'image/jpeg',
      'jpeg': 'image/jpeg',
      'svg' : 'image/svg+xml',
      'html': 'text/html',
      'htm' : 'text/html'
    },
    
    /**
     * Extracts abbreviations from text stream, starting from the end
     * @param {String} str
     * @return {String} Abbreviation or empty string
     * @memberOf emmet.actionUtils
     */
    extractAbbreviation: function(str) {
      var curOffset = str.length;
      var startIndex = -1;
      var groupCount = 0;
      var braceCount = 0;
      var textCount = 0;
      
      var utils = require('utils');
      var parser = require('abbreviationParser');
      
      while (true) {
        curOffset--;
        if (curOffset < 0) {
          // moved to the beginning of the line
          startIndex = 0;
          break;
        }
        
        var ch = str.charAt(curOffset);
        
        if (ch == ']') {
          braceCount++;
        } else if (ch == '[') {
          if (!braceCount) { // unexpected brace
            startIndex = curOffset + 1;
            break;
          }
          braceCount--;
        } else if (ch == '}') {
          textCount++;
        } else if (ch == '{') {
          if (!textCount) { // unexpected brace
            startIndex = curOffset + 1;
            break;
          }
          textCount--;
        } else if (ch == ')') {
          groupCount++;
        } else if (ch == '(') {
          if (!groupCount) { // unexpected brace
            startIndex = curOffset + 1;
            break;
          }
          groupCount--;
        } else {
          if (braceCount || textCount) 
            // respect all characters inside attribute sets or text nodes
            continue;
          else if (!parser.isAllowedChar(ch) || (ch == '>' && utils.endsWithTag(str.substring(0, curOffset + 1)))) {
            // found stop symbol
            startIndex = curOffset + 1;
            break;
          }
        }
      }
      
      if (startIndex != -1 && !textCount && !braceCount && !groupCount) 
        // found something, remove some invalid symbols from the 
        // beginning and return abbreviation
        return str.substring(startIndex).replace(/^[\*\+\>\^]+/, '');
      else
        return '';
    },
    
    /**
     * Gets image size from image byte stream.
     * @author http://romeda.org/rePublish/
     * @param {String} stream Image byte stream (use <code>IEmmetFile.read()</code>)
     * @return {Object} Object with <code>width</code> and <code>height</code> properties
     */
    getImageSize: function(stream) {
      var pngMagicNum = "\211PNG\r\n\032\n",
        jpgMagicNum = "\377\330",
        gifMagicNum = "GIF8",
        nextByte = function() {
          return stream.charCodeAt(pos++);
        };
    
      if (stream.substr(0, 8) === pngMagicNum) {
        // PNG. Easy peasy.
        var pos = stream.indexOf('IHDR') + 4;
      
        return { width:  (nextByte() << 24) | (nextByte() << 16) |
                 (nextByte() <<  8) | nextByte(),
             height: (nextByte() << 24) | (nextByte() << 16) |
                 (nextByte() <<  8) | nextByte() };
      
      } else if (stream.substr(0, 4) === gifMagicNum) {
        pos = 6;
      
        return {
          width:  nextByte() | (nextByte() << 8),
          height: nextByte() | (nextByte() << 8)
        };
      
      } else if (stream.substr(0, 2) === jpgMagicNum) {
        pos = 2;
      
        var l = stream.length;
        while (pos < l) {
          if (nextByte() != 0xFF) return;
        
          var marker = nextByte();
          if (marker == 0xDA) break;
        
          var size = (nextByte() << 8) | nextByte();
        
          if (marker >= 0xC0 && marker <= 0xCF && !(marker & 0x4) && !(marker & 0x8)) {
            pos += 1;
            return { height:  (nextByte() << 8) | nextByte(),
                 width: (nextByte() << 8) | nextByte() };
        
          } else {
            pos += size - 2;
          }
        }
      }
    },
    
    /**
     * Captures context XHTML element from editor under current caret position.
     * This node can be used as a helper for abbreviation extraction
     * @param {IEmmetEditor} editor
     * @returns {Object}
     */
    captureContext: function(editor) {
      var allowedSyntaxes = {'html': 1, 'xml': 1, 'xsl': 1};
      var syntax = String(editor.getSyntax());
      if (syntax in allowedSyntaxes) {
        var content = String(editor.getContent());
        var tag = require('htmlMatcher').find(content, editor.getCaretPos());
        
        if (tag && tag.type == 'tag') {
          var reAttr = /([\w\-:]+)(?:\s*=\s*(?:(?:"((?:\\.|[^"])*)")|(?:'((?:\\.|[^'])*)')|([^>\s]+)))?/g;
          var startTag = tag.open;
          var tagAttrs = startTag.range.substring(content).replace(/^<[\w\-\:]+/, '');
//          var tagAttrs = startTag.full_tag.replace(/^<[\w\-\:]+/, '');
          var contextNode = {
            name: startTag.name,
            attributes: []
          };
          
          // parse attributes
          var m;
          while (m = reAttr.exec(tagAttrs)) {
            contextNode.attributes.push({
              name: m[1],
              value: m[2]
            });
          }
          
          return contextNode;
        }
      }
      
      return null;
    },
    
    /**
     * Find expression bounds in current editor at caret position. 
     * On each character a <code>fn</code> function will be called and must 
     * return <code>true</code> if current character meets requirements, 
     * <code>false</code> otherwise
     * @param {IEmmetEditor} editor
     * @param {Function} fn Function to test each character of expression
     * @return {Range}
     */
    findExpressionBounds: function(editor, fn) {
      var content = String(editor.getContent());
      var il = content.length;
      var exprStart = editor.getCaretPos() - 1;
      var exprEnd = exprStart + 1;
        
      // start by searching left
      while (exprStart >= 0 && fn(content.charAt(exprStart), exprStart, content)) exprStart--;
      
      // then search right
      while (exprEnd < il && fn(content.charAt(exprEnd), exprEnd, content)) exprEnd++;
      
      if (exprEnd > exprStart) {
        return require('range').create([++exprStart, exprEnd]);
      }
    },
    
    /**
     * @param {IEmmetEditor} editor
     * @param {Object} data
     * @returns {Boolean}
     */
    compoundUpdate: function(editor, data) {
      if (data) {
        var sel = editor.getSelectionRange();
        editor.replaceContent(data.data, data.start, data.end, true);
        editor.createSelection(data.caret, data.caret + sel.end - sel.start);
        return true;
      }
      
      return false;
    },
    
    /**
     * Common syntax detection method for editors that doesn’t provide any
     * info about current syntax scope. 
     * @param {IEmmetEditor} editor Current editor
     * @param {String} hint Any syntax hint that editor can provide 
     * for syntax detection. Default is 'html'
     * @returns {String} 
     */
    detectSyntax: function(editor, hint) {
      var syntax = hint || 'html';
      
      if (!require('resources').hasSyntax(syntax)) {
        syntax = 'html';
      }
      
      if (syntax == 'html' && (this.isStyle(editor) || this.isInlineCSS(editor))) {
        syntax = 'css';
      }
      
      return syntax;
    },
    
    /**
     * Common method for detecting output profile
     * @param {IEmmetEditor} editor
     * @returns {String}
     */
    detectProfile: function(editor) {
      var syntax = editor.getSyntax();
      
      // get profile from syntax definition
      var profile = require('resources').findItem(syntax, 'profile');
      if (profile) {
        return profile;
      }
      
      switch(syntax) {
        case 'xml':
        case 'xsl':
          return 'xml';
        case 'css':
          if (this.isInlineCSS(editor)) {
            return 'line';
          }
          break;
        case 'html':
          var profile = require('resources').getVariable('profile');
          if (!profile) { // no forced profile, guess from content
            // html or xhtml?
            profile = this.isXHTML(editor) ? 'xhtml': 'html';
          }

          return profile;
      }

      return 'xhtml';
    },
    
    /**
     * Tries to detect if current document is XHTML one.
     * @param {IEmmetEditor} editor
     * @returns {Boolean}
     */
    isXHTML: function(editor) {
      return editor.getContent().search(/<!DOCTYPE[^>]+XHTML/i) != -1;
    },
    
    /**
     * Check if current caret position is inside &lt;style&gt; tag
     * @param {IEmmetEditor} editor
     * @returns
     */
    isStyle: function(editor) {
      var content = String(editor.getContent());
      var caretPos = editor.getCaretPos();
      var tag = require('htmlMatcher').tag(content, caretPos);
      return tag && tag.open.name.toLowerCase() == 'style' 
        && tag.innerRange.cmp(caretPos, 'lte', 'gte');
    },
    
    /**
     * Check if current caret position is inside "style" attribute of HTML
     * element
     * @param {IEmmetEditor} editor
     * @returns {Boolean}
     */
    isInlineCSS: function(editor) {
      var content = String(editor.getContent());
      var caretPos = editor.getCaretPos();
      var tree = require('xmlEditTree').parseFromPosition(content, caretPos, true);
            if (tree) {
                var attr = tree.itemFromPosition(caretPos, true);
                return attr && attr.name().toLowerCase() == 'style' 
                  && attr.valueRange(true).cmp(caretPos, 'lte', 'gte');
            }
            
            return false;
    }
  };
});/**
 * Utility functions to work with <code>AbbreviationNode</code> as HTML element
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('abbreviationUtils', function(require, _) {
  return {
    /**
     * Check if passed abbreviation node has matched snippet resource
     * @param {AbbreviationNode} node
     * @returns {Boolean}
     * @memberOf abbreviationUtils
     */
    isSnippet: function(node) {
      return require('elements').is(node.matchedResource(), 'snippet');
    },
    
    /**
     * Test if passed node is unary (no closing tag)
     * @param {AbbreviationNode} node
     * @return {Boolean}
     */
    isUnary: function(node) {
      var r = node.matchedResource();
      if (node.children.length || this.isSnippet(node))
        return false;
      
      return r && r.is_empty || require('tagName').isEmptyElement(node.name());
    },
    
    /**
     * Test if passed node is inline-level (like &lt;strong&gt;, &lt;img&gt;)
     * @param {AbbreviationNode} node
     * @return {Boolean}
     */
    isInline: function(node) {
      return node.isTextNode() 
        || !node.name() 
        || require('tagName').isInlineLevel(node.name());
    },
    
    /**
     * Test if passed node is block-level
     * @param {AbbreviationNode} node
     * @return {Boolean}
     */
    isBlock: function(node) {
      return this.isSnippet(node) || !this.isInline(node);
    },
    
    /**
     * Test if given node is a snippet
     * @param {AbbreviationNode} node
     * @return {Boolean}
     */
    isSnippet: function(node) {
      return require('elements').is(node.matchedResource(), 'snippet');
    },
    
    /**
     * This function tests if passed node content contains HTML tags. 
     * This function is mostly used for output formatting
     * @param {AbbreviationNode} node
     * @returns {Boolean}
     */
    hasTagsInContent: function(node) {
      return require('utils').matchesTag(node.content);
    },
    
    /**
     * Test if current element contains block-level children
     * @param {AbbreviationNode} node
     * @return {Boolean}
     */
    hasBlockChildren: function(node) {
      return (this.hasTagsInContent(node) && this.isBlock(node)) 
        || _.any(node.children, function(child) {
          return this.isBlock(child);
        }, this);
    },
    
    /**
     * Utility function that inserts content instead of <code>${child}</code>
     * variables on <code>text</code>
     * @param {String} text Text where child content should be inserted
     * @param {String} childContent Content to insert
     * @param {Object} options
     * @returns {String
     */
    insertChildContent: function(text, childContent, options) {
      options = _.extend({
        keepVariable: true,
        appendIfNoChild: true
      }, options || {});
      
      var childVariableReplaced = false;
      var utils = require('utils');
      text = utils.replaceVariables(text, function(variable, name, data) {
        var output = variable;
        if (name == 'child') {
          // add correct indentation
          output = utils.padString(childContent, utils.getLinePaddingFromPosition(text, data.start));
          childVariableReplaced = true;
          if (options.keepVariable)
            output += variable;
        }
        
        return output;
      });
      
      if (!childVariableReplaced && options.appendIfNoChild) {
        text += childContent;
      }
      
      return text;
    }
  };
});/**
 * @author Sergey Chikuyonok (serge.che@gmail.com)
 * @link http://chikuyonok.ru
 */
emmet.define('base64', function(require, _) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  
  return {
    /**
     * Encodes data using base64 algorithm
     * @author Tyler Akins (http://rumkin.com)
     * @param {String} input
     * @returns {String}
     * @memberOf emmet.base64
     */
    encode : function(input) {
      var output = [];
      var chr1, chr2, chr3, enc1, enc2, enc3, enc4, cdp1, cdp2, cdp3;
      var i = 0, il = input.length, b64 = chars;

      while (i < il) {

        cdp1 = input.charCodeAt(i++);
        cdp2 = input.charCodeAt(i++);
        cdp3 = input.charCodeAt(i++);

        chr1 = cdp1 & 0xff;
        chr2 = cdp2 & 0xff;
        chr3 = cdp3 & 0xff;

        enc1 = chr1 >> 2;
        enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
        enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
        enc4 = chr3 & 63;

        if (isNaN(cdp2)) {
          enc3 = enc4 = 64;
        } else if (isNaN(cdp3)) {
          enc4 = 64;
        }

        output.push(b64.charAt(enc1) + b64.charAt(enc2) + b64.charAt(enc3) + b64.charAt(enc4));
      }

      return output.join('');
    },

    /**
     * Decodes string using MIME base64 algorithm
     * 
     * @author Tyler Akins (http://rumkin.com)
     * @param {String} data
     * @return {String}
     */
    decode : function(data) {
      var o1, o2, o3, h1, h2, h3, h4, bits, i = 0, ac = 0, tmpArr = [];
      var b64 = chars, il = data.length;

      if (!data) {
        return data;
      }

      data += '';

      do { // unpack four hexets into three octets using index points in b64
        h1 = b64.indexOf(data.charAt(i++));
        h2 = b64.indexOf(data.charAt(i++));
        h3 = b64.indexOf(data.charAt(i++));
        h4 = b64.indexOf(data.charAt(i++));

        bits = h1 << 18 | h2 << 12 | h3 << 6 | h4;

        o1 = bits >> 16 & 0xff;
        o2 = bits >> 8 & 0xff;
        o3 = bits & 0xff;

        if (h3 == 64) {
          tmpArr[ac++] = String.fromCharCode(o1);
        } else if (h4 == 64) {
          tmpArr[ac++] = String.fromCharCode(o1, o2);
        } else {
          tmpArr[ac++] = String.fromCharCode(o1, o2, o3);
        }
      } while (i < il);

      return tmpArr.join('');
    }
  };
});/**
 * HTML matcher: takes string and searches for HTML tag pairs for given position 
 * 
 * Unlike “classic” matchers, it parses content from the specified 
 * position, not from the start, so it may work even outside HTML documents
 * (for example, inside strings of programming languages like JavaScript, Python 
 * etc.)
 * @constructor
 * @memberOf __htmlMatcherDefine
 */
emmet.define('htmlMatcher', function(require, _) {
  // Regular Expressions for parsing tags and attributes
  var reOpenTag = /^<([\w\:\-]+)((?:\s+[\w\-:]+(?:\s*=\s*(?:(?:"[^"]*")|(?:'[^']*')|[^>\s]+))?)*)\s*(\/?)>/;
  var reCloseTag = /^<\/([\w\:\-]+)[^>]*>/;
  
  function openTag(i, match) {
    return {
      name: match[1],
      selfClose: !!match[3],
      /** @type Range */
      range: require('range').create(i, match[0]),
      type: 'open'
    };
  }
  
  function closeTag(i, match) {
    return {
      name: match[1],
      /** @type Range */
      range: require('range').create(i, match[0]),
      type: 'close'
    };
  }
  
  function comment(i, match) {
    return {
      /** @type Range */
      range: require('range').create(i, _.isNumber(match) ? match - i : match[0]),
      type: 'comment'
    };
  }
  
  /**
   * Creates new tag matcher session
   * @param {String} text
   */
  function createMatcher(text) {
    var memo = {}, m;
    return {
      /**
       * Test if given position matches opening tag
       * @param {Number} i
       * @returns {Object} Matched tag object
       */
      open: function(i) {
        var m = this.matches(i);
        return m && m.type == 'open' ? m : null;
      },
      
      /**
       * Test if given position matches closing tag
       * @param {Number} i
       * @returns {Object} Matched tag object
       */
      close: function(i) {
        var m = this.matches(i);
        return m && m.type == 'close' ? m : null;
      },
      
      /**
       * Matches either opening or closing tag for given position
       * @param i
       * @returns
       */
      matches: function(i) {
        var key = 'p' + i;
        
        if (!(key in memo)) {
          if (text.charAt(i) == '<') {
            var substr = text.slice(i);
            if (m = substr.match(reOpenTag)) {
              memo[key] = openTag(i, m);
            } else if (m = substr.match(reCloseTag)) {
              memo[key] = closeTag(i, m);
            } else {
              // remember that given position contains no valid tag
              memo[key] = false;
            }
          }
        }
        
        return memo[key];
      },
      
      /**
       * Returns original text
       * @returns {String}
       */
      text: function() {
        return text;
      }
    };
  }
  
  function matches(text, pos, pattern) {
    return text.substring(pos, pos + pattern.length) == pattern;
  }
  
  /**
   * Search for closing pair of opening tag
   * @param {Object} open Open tag instance
   * @param {Object} matcher Matcher instance
   */
  function findClosingPair(open, matcher) {
    var stack = [], tag = null;
    var text = matcher.text();
    
    for (var pos = open.range.end, len = text.length; pos < len; pos++) {
      if (matches(text, pos, '<!--')) {
        // skip to end of comment
        for (var j = pos; j < len; j++) {
          if (matches(text, j, '-->')) {
            pos = j + 3;
            break;
          }
        }
      }
      
      if (tag = matcher.matches(pos)) {
        if (tag.type == 'open' && !tag.selfClose) {
          stack.push(tag.name);
        } else if (tag.type == 'close') {
          if (!stack.length) { // found valid pair?
            return tag.name == open.name ? tag : null;
          }
          
          // check if current closing tag matches previously opened one
          if (_.last(stack) == tag.name) {
            stack.pop();
          } else {
            var found = false;
            while (stack.length && !found) {
              var last = stack.pop();
              if (last == tag.name) {
                found = true;
              }
            }
            
            if (!stack.length && !found) {
              return tag.name == open.name ? tag : null;
            }
          }
        }
      }
      
    }
  }
  
  return {
    /**
     * Main function: search for tag pair in <code>text</code> for given 
     * position
     * @memberOf htmlMatcher
     * @param {String} text 
     * @param {Number} pos
     * @returns {Object}
     */
    find: function(text, pos) {
      var range = require('range');
      var matcher = createMatcher(text); 
      var open = null, close = null;
      
      for (var i = pos; i >= 0; i--) {
        if (open = matcher.open(i)) {
          // found opening tag
          if (open.selfClose) {
            if (open.range.cmp(pos, 'lt', 'gt')) {
              // inside self-closing tag, found match
              break;
            }
            
            // outside self-closing tag, continue
            continue;
          }
          
          close = findClosingPair(open, matcher);
          if (close) {
            // found closing tag.
            var r = range.create2(open.range.start, close.range.end);
            if (r.contains(pos)) {
              break;
            }
          } else if (open.range.contains(pos)) {
            // we inside empty HTML tag like <br>
            break;
          }
          
          open = null;
        } else if (matches(text, i, '-->')) {
          // skip back to comment start
          for (var j = i - 1; j >= 0; j--) {
            if (matches(text, j, '-->')) {
              // found another comment end, do nothing
              break;
            } else if (matches(text, j, '<!--')) {
              i = j;
              break;
            }
          }
        } else if (matches(text, i, '<!--')) {
          // we're inside comment, match it
          var j = i + 4, jl = text.length;
          for (; j < jl; j++) {
            if (matches(text, j, '-->')) {
              j += 3;
              break;
            }
          }
          
          open = comment(i, j);
          break;
        }
      }
      
      if (open) {
        var outerRange = null;
        var innerRange = null;
        
        if (close) {
          outerRange = range.create2(open.range.start, close.range.end);
          innerRange = range.create2(open.range.end, close.range.start);
        } else {
          outerRange = innerRange = range.create2(open.range.start, open.range.end);
        }
        
        if (open.type == 'comment') {
          // adjust positions of inner range for comment
          var _c = outerRange.substring(text);
          innerRange.start += _c.length - _c.replace(/^<\!--\s*/, '').length;
          innerRange.end -= _c.length - _c.replace(/\s*-->$/, '').length;
        }
        
        return {
          open: open,
          close: close,
          type: open.type == 'comment' ? 'comment' : 'tag',
          innerRange: innerRange,
          innerContent: function() {
            return this.innerRange.substring(text);
          },
          outerRange: outerRange,
          outerContent: function() {
            return this.outerRange.substring(text);
          },
          range: !innerRange.length() || !innerRange.cmp(pos, 'lte', 'gte') ? outerRange : innerRange,
          content: function() {
            return this.range.substring(text);
          },
          source: text
        };
      }
    },
    
    /**
     * The same as <code>find()</code> method, but restricts matched result 
     * to <code>tag</code> type
     * @param {String} text 
     * @param {Number} pos
     * @returns {Object}
     */
    tag: function(text, pos) {
      var result = this.find(text, pos);
      if (result && result.type == 'tag') {
        return result;
      }
    }
  };
});/**
 * Utility module for handling tabstops tokens generated by Emmet's 
 * "Expand Abbreviation" action. The main <code>extract</code> method will take
 * raw text (for example: <i>${0} some ${1:text}</i>), find all tabstops 
 * occurrences, replace them with tokens suitable for your editor of choice and 
 * return object with processed text and list of found tabstops and their ranges.
 * For sake of portability (Objective-C/Java) the tabstops list is a plain 
 * sorted array with plain objects.
 * 
 * Placeholders with the same are meant to be <i>linked</i> in your editor.
 * @param {Function} require
 * @param {Underscore} _  
 */
emmet.define('tabStops', function(require, _) {
  /**
   * Global placeholder value, automatically incremented by 
   * <code>variablesResolver()</code> function
   */
  var startPlaceholderNum = 100;
  
  var tabstopIndex = 0;
  
  var defaultOptions = {
    replaceCarets: false,
    escape: function(ch) {
      return '\\' + ch;
    },
    tabstop: function(data) {
      return data.token;
    },
    variable: function(data) {
      return data.token;
    }
  };
  
  // XXX register output processor that will upgrade tabstops of parsed node
  // in order to prevent tabstop index conflicts
  require('abbreviationParser').addOutputProcessor(function(text, node, type) {
    var maxNum = 0;
    var tabstops = require('tabStops');
    var utils = require('utils');
    
    var tsOptions = {
      tabstop: function(data) {
        var group = parseInt(data.group);
        if (group == 0)
          return '${0}';
        
        if (group > maxNum) maxNum = group;
        if (data.placeholder) {
          // respect nested placeholders
          var ix = group + tabstopIndex;
          var placeholder = tabstops.processText(data.placeholder, tsOptions);
          return '${' + ix + ':' + placeholder + '}';
        } else {
          return '${' + (group + tabstopIndex) + '}';
        }
      }
    };
    
    // upgrade tabstops
    text = tabstops.processText(text, tsOptions);
    
    // resolve variables
    text = utils.replaceVariables(text, tabstops.variablesResolver(node));
    
    tabstopIndex += maxNum + 1;
    return text;
  });
  
  return {
    /**
     * Main function that looks for a tabstops in provided <code>text</code>
     * and returns a processed version of <code>text</code> with expanded 
     * placeholders and list of tabstops found.
     * @param {String} text Text to process
     * @param {Object} options List of processor options:<br>
     * 
     * <b>replaceCarets</b> : <code>Boolean</code> — replace all default
     * caret placeholders (like <i>{%::emmet-caret::%}</i>) with <i>${0:caret}</i><br>
     * 
     * <b>escape</b> : <code>Function</code> — function that handle escaped
     * characters (mostly '$'). By default, it returns the character itself 
     * to be displayed as is in output, but sometimes you will use 
     * <code>extract</code> method as intermediate solution for further 
     * processing and want to keep character escaped. Thus, you should override
     * <code>escape</code> method to return escaped symbol (e.g. '\\$')<br>
     * 
     * <b>tabstop</b> : <code>Function</code> – a tabstop handler. Receives 
     * a single argument – an object describing token: its position, number 
     * group, placeholder and token itself. Should return a replacement 
     * string that will appear in final output
     * 
     * <b>variable</b> : <code>Function</code> – variable handler. Receives 
     * a single argument – an object describing token: its position, name 
     * and original token itself. Should return a replacement 
     * string that will appear in final output
     * 
     * @returns {Object} Object with processed <code>text</code> property
     * and array of <code>tabstops</code> found
     * @memberOf tabStops
     */
    extract: function(text, options) {
      // prepare defaults
      var utils = require('utils');
      var placeholders = {carets: ''};
      var marks = [];
      
      options = _.extend({}, defaultOptions, options, {
        tabstop: function(data) {
          var token = data.token;
          var ret = '';
          if (data.placeholder == 'cursor') {
            marks.push({
              start: data.start,
              end: data.start + token.length,
              group: 'carets',
              value: ''
            });
          } else {
            // unify placeholder value for single group
            if ('placeholder' in data)
              placeholders[data.group] = data.placeholder;
            
            if (data.group in placeholders)
              ret = placeholders[data.group];
            
            marks.push({
              start: data.start,
              end: data.start + token.length,
              group: data.group,
              value: ret
            });
          }
          
          return token;
        }
      });
      
      if (options.replaceCarets) {
        text = text.replace(new RegExp( utils.escapeForRegexp( utils.getCaretPlaceholder() ), 'g'), '${0:cursor}');
      }
      
      // locate tabstops and unify group's placeholders
      text = this.processText(text, options);
      
      // now, replace all tabstops with placeholders
      var buf = utils.stringBuilder(), lastIx = 0;
      var tabStops = _.map(marks, function(mark) {
        buf.append(text.substring(lastIx, mark.start));
        
        var pos = buf.length;
        var ph = placeholders[mark.group] || '';
        
        buf.append(ph);
        lastIx = mark.end;
        
        return {
          group: mark.group,
          start: pos,
          end:  pos + ph.length
        };
      });
      
      buf.append(text.substring(lastIx));
      
      return {
        text: buf.toString(),
        tabstops: _.sortBy(tabStops, 'start')
      };
    },
    
    /**
     * Text processing routine. Locates escaped characters and tabstops and
     * replaces them with values returned by handlers defined in 
     * <code>options</code>
     * @param {String} text
     * @param {Object} options See <code>extract</code> method options 
     * description
     * @returns {String}
     */
    processText: function(text, options) {
      options = _.extend({}, defaultOptions, options);
      
      var buf = require('utils').stringBuilder();
      /** @type StringStream */
      var stream = require('stringStream').create(text);
      var ch, m, a;
      
      while (ch = stream.next()) {
        if (ch == '\\' && !stream.eol()) {
          // handle escaped character
          buf.append(options.escape(stream.next()));
          continue;
        }
        
        a = ch;
        
        if (ch == '$') {
          // looks like a tabstop
          stream.start = stream.pos - 1;
          
          if (m = stream.match(/^[0-9]+/)) {
            // it's $N
            a = options.tabstop({
              start: buf.length, 
              group: stream.current().substr(1),
              token: stream.current()
            });
          } else if (m = stream.match(/^\{([a-z_\-][\w\-]*)\}/)) {
            // ${variable}
            a = options.variable({
              start: buf.length, 
              name: m[1],
              token: stream.current()
            });
          } else if (m = stream.match(/^\{([0-9]+)(:.+?)?\}/, false)) {
            // ${N:value} or ${N} placeholder
            // parse placeholder, including nested ones
            stream.skipToPair('{', '}');
            
            var obj = {
              start: buf.length, 
              group: m[1],
              token: stream.current()
            };
            
            var placeholder = obj.token.substring(obj.group.length + 2, obj.token.length - 1);
            
            if (placeholder) {
              obj.placeholder = placeholder.substr(1);
            }
            
            a = options.tabstop(obj);
          }
        }
        
        buf.append(a);
      }
      
      return buf.toString();
    },
    
    /**
     * Upgrades tabstops in output node in order to prevent naming conflicts
     * @param {AbbreviationNode} node
     * @param {Number} offset Tab index offset
     * @returns {Number} Maximum tabstop index in element
     */
    upgrade: function(node, offset) {
      var maxNum = 0;
      var options = {
        tabstop: function(data) {
          var group = parseInt(data.group);
          if (group > maxNum) maxNum = group;
            
          if (data.placeholder)
            return '${' + (group + offset) + ':' + data.placeholder + '}';
          else
            return '${' + (group + offset) + '}';
        }
      };
      
      _.each(['start', 'end', 'content'], function(p) {
        node[p] = this.processText(node[p], options);
      }, this);
      
      return maxNum;
    },
    
    /**
     * Helper function that produces a callback function for 
     * <code>replaceVariables()</code> method from {@link utils}
     * module. This callback will replace variable definitions (like 
     * ${var_name}) with their value defined in <i>resource</i> module,
     * or outputs tabstop with variable name otherwise.
     * @param {AbbreviationNode} node Context node
     * @returns {Function}
     */
    variablesResolver: function(node) {
      var placeholderMemo = {};
      var res = require('resources');
      return function(str, varName) {
        // do not mark `child` variable as placeholder – it‘s a reserved
        // variable name
        if (varName == 'child')
          return str;
        
        if (varName == 'cursor')
          return require('utils').getCaretPlaceholder();
        
        var attr = node.attribute(varName);
        if (!_.isUndefined(attr) && attr !== str) {
          return attr;
        }
        
        var varValue = res.getVariable(varName);
        if (varValue)
          return varValue;
        
        // output as placeholder
        if (!placeholderMemo[varName])
          placeholderMemo[varName] = startPlaceholderNum++;
          
        return '${' + placeholderMemo[varName] + ':' + varName + '}';
      };
    },
    
    /**
     * Resets global tabstop index. When parsed tree is converted to output
     * string (<code>AbbreviationNode.toString()</code>), all tabstops 
     * defined in snippets and elements are upgraded in order to prevent
     * naming conflicts of nested. For example, <code>${1}</code> of a node
     * should not be linked with the same placehilder of the child node.
     * By default, <code>AbbreviationNode.toString()</code> automatically
     * upgrades tabstops of the same index for each node and writes maximum
     * tabstop index into the <code>tabstopIndex</code> variable. To keep
     * this variable at reasonable value, it is recommended to call 
     * <code>resetTabstopIndex()</code> method each time you expand variable 
     * @returns
     */
    resetTabstopIndex: function() {
      tabstopIndex = 0;
      startPlaceholderNum = 100;
    }
  };
});/**
 * Common module's preferences storage. This module 
 * provides general storage for all module preferences, their description and
 * default values.<br><br>
 * 
 * This module can also be used to list all available properties to create 
 * UI for updating properties
 * 
 * @memberOf __preferencesDefine
 * @constructor
 * @param {Function} require
 * @param {Underscore} _ 
 */
emmet.define('preferences', function(require, _) {
  var preferences = {};
  var defaults = {};
  var _dbgDefaults = null;
  var _dbgPreferences = null;

  function toBoolean(val) {
    if (_.isString(val)) {
      val = val.toLowerCase();
      return val == 'yes' || val == 'true' || val == '1';
    }

    return !!val;
  }
  
  function isValueObj(obj) {
    return _.isObject(obj) 
      && 'value' in obj 
      && _.keys(obj).length < 3;
  }
  
  return {
    /**
     * Creates new preference item with default value
     * @param {String} name Preference name. You can also pass object
     * with many options
     * @param {Object} value Preference default value
     * @param {String} description Item textual description
     * @memberOf preferences
     */
    define: function(name, value, description) {
      var prefs = name;
      if (_.isString(name)) {
        prefs = {};
        prefs[name] = {
          value: value,
          description: description
        };
      }
      
      _.each(prefs, function(v, k) {
        defaults[k] = isValueObj(v) ? v : {value: v};
      });
    },
    
    /**
     * Updates preference item value. Preference value should be defined
     * first with <code>define</code> method.
     * @param {String} name Preference name. You can also pass object
     * with many options
     * @param {Object} value Preference default value
     * @memberOf preferences
     */
    set: function(name, value) {
      var prefs = name;
      if (_.isString(name)) {
        prefs = {};
        prefs[name] = value;
      }
      
      _.each(prefs, function(v, k) {
        if (!(k in defaults)) {
          throw 'Property "' + k + '" is not defined. You should define it first with `define` method of current module';
        }
        
        // do not set value if it equals to default value
        if (v !== defaults[k].value) {
          // make sure we have value of correct type
          switch (typeof defaults[k].value) {
            case 'boolean':
              v = toBoolean(v);
              break;
            case 'number':
              v = parseInt(v + '', 10) || 0;
              break;
            default: // convert to string
              v += '';
          }

          preferences[k] = v;
        } else if  (k in preferences) {
          delete preferences[k];
        }
      });
    },
    
    /**
     * Returns preference value
     * @param {String} name
     * @returns {String} Returns <code>undefined</code> if preference is 
     * not defined
     */
    get: function(name) {
      if (name in preferences)
        return preferences[name];
      
      if (name in defaults)
        return defaults[name].value;
      
      return void 0;
    },
    
    /**
     * Returns comma-separated preference value as array of values
     * @param {String} name
     * @returns {Array} Returns <code>undefined</code> if preference is 
     * not defined, <code>null</code> if string cannot be converted to array
     */
    getArray: function(name) {
      var val = this.get(name);
      if (!_.isUndefined(val)) {
        val = _.map(val.split(','), require('utils').trim);
        if (!val.length)
          val = null;
      }
      
      return val;
    },
    
    /**
     * Returns comma and colon-separated preference value as dictionary
     * @param {String} name
     * @returns {Object}
     */
    getDict: function(name) {
      var result = {};
      _.each(this.getArray(name), function(val) {
        var parts = val.split(':');
        result[parts[0]] = parts[1];
      });
      
      return result;
    },
    
    /**
     * Returns description of preference item
     * @param {String} name Preference name
     * @returns {Object}
     */
    description: function(name) {
      return name in defaults ? defaults[name].description : void 0;
    },
    
    /**
     * Completely removes specified preference(s)
     * @param {String} name Preference name (or array of names)
     */
    remove: function(name) {
      if (!_.isArray(name))
        name = [name];
      
      _.each(name, function(key) {
        if (key in preferences)
          delete preferences[key];
        
        if (key in defaults)
          delete defaults[key];
      });
    },
    
    /**
     * Returns sorted list of all available properties
     * @returns {Array}
     */
    list: function() {
      return _.map(_.keys(defaults).sort(), function(key) {
        return {
          name: key,
          value: this.get(key),
          type: typeof defaults[key].value,
          description: defaults[key].description
        };
      }, this);
    },
    
    /**
     * Loads user-defined preferences from JSON
     * @param {Object} json
     * @returns
     */
    load: function(json) {
      _.each(json, function(value, key) {
        this.set(key, value);
      }, this);
    },

    /**
     * Returns hash of user-modified preferences
     * @returns {Object}
     */
    exportModified: function() {
      return _.clone(preferences);
    },
    
    /**
     * Reset to defaults
     * @returns
     */
    reset: function() {
      preferences = {};
    },
    
    /**
     * For unit testing: use empty storage
     */
    _startTest: function() {
      _dbgDefaults = defaults;
      _dbgPreferences = preferences;
      defaults = {};
      preferences = {};
    },
    
    /**
     * For unit testing: restore original storage
     */
    _stopTest: function() {
      defaults = _dbgDefaults;
      preferences = _dbgPreferences;
    }
  };
});/**
 * Module for handling filters
 * @param {Function} require
 * @param {Underscore} _
 * @author Sergey Chikuyonok (serge.che@gmail.com) <http://chikuyonok.ru>
 */
emmet.define('filters', function(require, _) {
  /** List of registered filters */
  var registeredFilters = {};
  
  /** Filters that will be applied for unknown syntax */
  var basicFilters = 'html';
  
  function list(filters) {
    if (!filters)
      return [];
    
    if (_.isString(filters))
      return filters.split(/[\|,]/g);
    
    return filters;
  }
  
  return  {
    /**
     * Register new filter
     * @param {String} name Filter name
     * @param {Function} fn Filter function
     */
    add: function(name, fn) {
      registeredFilters[name] = fn;
    },
    
    /**
     * Apply filters for final output tree
     * @param {AbbreviationNode} tree Output tree
     * @param {Array} filters List of filters to apply. Might be a 
     * <code>String</code>
     * @param {Object} profile Output profile, defined in <i>profile</i> 
     * module. Filters defined it profile are not used, <code>profile</code>
     * is passed to filter function
     * @memberOf emmet.filters
     * @returns {AbbreviationNode}
     */
    apply: function(tree, filters, profile) {
      var utils = require('utils');
      profile = require('profile').get(profile);
      
      _.each(list(filters), function(filter) {
        var name = utils.trim(filter.toLowerCase());
        if (name && name in registeredFilters) {
          tree = registeredFilters[name](tree, profile);
        }
      });
      
      return tree;
    },
    
    /**
     * Composes list of filters that should be applied to a tree, based on 
     * passed data
     * @param {String} syntax Syntax name ('html', 'css', etc.)
     * @param {Object} profile Output profile
     * @param {String} additionalFilters List or pipe-separated
     * string of additional filters to apply
     * @returns {Array}
     */
    composeList: function(syntax, profile, additionalFilters) {
      profile = require('profile').get(profile);
      var filters = list(profile.filters || require('resources').findItem(syntax, 'filters') || basicFilters);
      
      if (profile.extraFilters) {
        filters = filters.concat(list(profile.extraFilters));
      }
        
      if (additionalFilters) {
        filters = filters.concat(list(additionalFilters));
      }
        
      if (!filters || !filters.length) {
        // looks like unknown syntax, apply basic filters
        filters = list(basicFilters);
      }
        
      return filters;
    },
    
    /**
     * Extracts filter list from abbreviation
     * @param {String} abbr
     * @returns {Array} Array with cleaned abbreviation and list of 
     * extracted filters
     */
    extractFromAbbreviation: function(abbr) {
      var filters = '';
      abbr = abbr.replace(/\|([\w\|\-]+)$/, function(str, p1){
        filters = p1;
        return '';
      });
      
      return [abbr, list(filters)];
    }
  };
});/**
 * Module that contains factories for element types used by Emmet
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('elements', function(require, _) {
  var factories = {};
  var reAttrs = /([\w\-]+)\s*=\s*(['"])(.*?)\2/g;
  
  var result = {
    /**
     * Create new element factory
     * @param {String} name Element identifier
     * @param {Function} factory Function that produces element of specified 
     * type. The object generated by this factory is automatically 
     * augmented with <code>type</code> property pointing to element
     * <code>name</code>
     * @memberOf elements
     */
    add: function(name, factory) {
      var that = this;
      factories[name] = function() {
        var elem = factory.apply(that, arguments);
        if (elem)
          elem.type = name;
        
        return elem;
      };
    },
    
    /**
     * Returns factory for specified name
     * @param {String} name
     * @returns {Function}
     */
    get: function(name) {
      return factories[name];
    },
    
    /**
     * Creates new element with specified type
     * @param {String} name
     * @returns {Object}
     */
    create: function(name) {
      var args = [].slice.call(arguments, 1);
      var factory = this.get(name);
      return factory ? factory.apply(this, args) : null;
    },
    
    /**
     * Check if passed element is of specified type
     * @param {Object} elem
     * @param {String} type
     * @returns {Boolean}
     */
    is: function(elem, type) {
      return elem && elem.type === type;
    }
  };
  
  // register resource references
  function commonFactory(value) {
    return {data: value};
  }
  
  /**
   * Element factory
   * @param {String} elementName Name of output element
   * @param {String} attrs Attributes definition. You may also pass
   * <code>Array</code> where each contains object with <code>name</code> 
   * and <code>value</code> properties, or <code>Object</code>
   * @param {Boolean} isEmpty Is expanded element should be empty
   */
  result.add('element', function(elementName, attrs, isEmpty) {
    var ret = {
      /** @memberOf __emmetDataElement */
      name: elementName,
      is_empty: !!isEmpty
    };
    
    if (attrs) {
      ret.attributes = [];
      if (_.isArray(attrs)) {
        ret.attributes = attrs;
      } else if (_.isString(attrs)) {
        var m;
        while (m = reAttrs.exec(attrs)) {
          ret.attributes.push({
            name: m[1],
            value: m[3]
          });
        }
      } else {
        _.each(attrs, function(value, name) {
          ret.attributes.push({
            name: name, 
            value: value
          });
        });
      }
    }
    
    return ret;
  });
  
  result.add('snippet', commonFactory);
  result.add('reference', commonFactory);
  result.add('empty', function() {
    return {};
  });
  
  return result;
});/**
 * Abstract implementation of edit tree interface.
 * Edit tree is a named container of editable “name-value” child elements, 
 * parsed from <code>source</code>. This container provides convenient methods
 * for editing/adding/removing child elements. All these update actions are
 * instantly reflected in the <code>source</code> code with respect of formatting.
 * <br><br>
 * For example, developer can create an edit tree from CSS rule and add or 
 * remove properties from it–all changes will be immediately reflected in the 
 * original source.
 * <br><br>
 * All classes defined in this module should be extended the same way as in
 * Backbone framework: using <code>extend</code> method to create new class and 
 * <code>initialize</code> method to define custom class constructor.
 * 
 * @example
 * <pre><code>
 * var MyClass = require('editTree').EditElement.extend({
 *  initialize: function() {
 *    // constructor code here
 *  }
 * });
 * 
 * var elem = new MyClass(); 
 * </code></pre>
 * 
 * 
 * @param {Function} require
 * @param {Underscore} _
 * @constructor
 * @memberOf __editTreeDefine
 */
emmet.define('editTree', function(require, _, core) {
  var range = require('range').create;
  
  /**
   * Named container of edited source
   * @type EditContainer
   * @param {String} source
   * @param {Object} options
   */
  function EditContainer(source, options) {
    this.options = _.extend({offset: 0}, options);
    /**
     * Source code of edited structure. All changes in the structure are 
     * immediately reflected into this property
     */
    this.source = source;
    
    /** 
     * List of all editable children
     * @private 
     */
    this._children = [];
    
    /**
     * Hash of all positions of container
     * @private
     */
    this._positions = {
      name: 0
    };
    
    this.initialize.apply(this, arguments);
  }
  
  /**
   * The self-propagating extend function for classes.
   * @type Function
   */
  EditContainer.extend = core.extend;
  
  EditContainer.prototype = {
    /**
     * Child class constructor
     */
    initialize: function() {},
    
    /**
     * Replace substring of tag's source
     * @param {String} value
     * @param {Number} start
     * @param {Number} end
     * @private
     */
    _updateSource: function(value, start, end) {
      // create modification range
      var r = range(start, _.isUndefined(end) ? 0 : end - start);
      var delta = value.length - r.length();
      
      var update = function(obj) {
        _.each(obj, function(v, k) {
          if (v >= r.end)
            obj[k] += delta;
        });
      };
      
      // update affected positions of current container
      update(this._positions);
      
      // update affected positions of children
      _.each(this.list(), function(item) {
        update(item._positions);
      });
      
      this.source = require('utils').replaceSubstring(this.source, value, r);
    },
      
      
    /**
     * Adds new attribute 
     * @param {String} name Property name
     * @param {String} value Property value
     * @param {Number} pos Position at which to insert new property. By 
     * default the property is inserted at the end of rule 
     * @returns {EditElement} Newly created element
     */
    add: function(name, value, pos) {
      // this is abstract implementation
      var item = new EditElement(name, value);
      this._children.push(item);
      return item;
    },
    
    /**
     * Returns attribute object
     * @param {String} name Attribute name or its index
     * @returns {EditElement}
     */
    get: function(name) {
      if (_.isNumber(name))
        return this.list()[name];
      
      if (_.isString(name))
        return _.find(this.list(), function(prop) {
          return prop.name() === name;
        });
      
      return name;
    },
    
    /**
     * Returns all children by name or indexes
     * @param {Object} name Element name(s) or indexes (<code>String</code>,
     * <code>Array</code>, <code>Number</code>)
     * @returns {Array}
     */
    getAll: function(name) {
      if (!_.isArray(name))
        name = [name];
      
      // split names and indexes
      var names = [], indexes = [];
      _.each(name, function(item) {
        if (_.isString(item))
          names.push(item);
        else if (_.isNumber(item))
          indexes.push(item);
      });
      
      return _.filter(this.list(), function(attribute, i) {
        return _.include(indexes, i) || _.include(names, attribute.name());
      });
    },
    
    /**
     * Returns or updates element value. If such element doesn't exists,
     * it will be created automatically and added at the end of child list.
     * @param {String} name Element name or its index
     * @param {String} value New element value
     * @returns {String}
     */
    value: function(name, value, pos) {
      var element = this.get(name);
      if (element)
        return element.value(value);
      
      if (!_.isUndefined(value)) {
        // no such element — create it
        return this.add(name, value, pos);
      }
    },
    
    /**
     * Returns all values of child elements found by <code>getAll()</code>
     * method
     * @param {Object} name Element name(s) or indexes (<code>String</code>,
     * <code>Array</code>, <code>Number</code>)
     * @returns {Array}
     */
    values: function(name) {
      return _.map(this.getAll(name), function(element) {
        return element.value();
      });
    },
    
    /**
     * Remove child element
     * @param {String} name Property name or its index
     */
    remove: function(name) {
      var element = this.get(name);
      if (element) {
        this._updateSource('', element.fullRange());
        this._children = _.without(this._children, element);
      }
    },
    
    /**
     * Returns list of all editable child elements
     * @returns {Array}
     */
    list: function() {
      return this._children;
    },
    
    /**
     * Returns index of editble child in list
     * @param {Object} item
     * @returns {Number}
     */
    indexOf: function(item) {
      return _.indexOf(this.list(), this.get(item));
    },
    
    /**
     * Sets or gets container name
     * @param {String} val New name. If not passed, current 
     * name is returned
     * @return {String}
     */
    name: function(val) {
      if (!_.isUndefined(val) && this._name !== (val = String(val))) {
        this._updateSource(val, this._positions.name, this._positions.name + this._name.length);
        this._name = val;
      }
      
      return this._name;
    },
    
    /**
     * Returns name range object
     * @param {Boolean} isAbsolute Return absolute range (with respect of 
     * rule offset)
     * @returns {Range}
     */
    nameRange: function(isAbsolute) {
      return range(this._positions.name + (isAbsolute ? this.options.offset : 0), this.name());
    },
    
    /**
     * Returns range of current source
     * @param {Boolean} isAbsolute
     */
    range: function(isAbsolute) {
      return range(isAbsolute ? this.options.offset : 0, this.toString());
    },
    
    /**
     * Returns element that belongs to specified position
     * @param {Number} pos
     * @param {Boolean} isAbsolute
     * @returns {EditElement}
     */
    itemFromPosition: function(pos, isAbsolute) {
      return _.find(this.list(), function(elem) {
        return elem.range(isAbsolute).inside(pos);
      });
    },
    
    /**
     * Returns source code of current container 
     * @returns {String}
     */
    toString: function() {
      return this.source;
    }
  };
  
  /**
   * @param {EditContainer} parent
   * @param {Object} nameToken
   * @param {Object} valueToken
   */
  function EditElement(parent, nameToken, valueToken) {
    /** @type EditContainer */
    this.parent = parent;
    
    this._name = nameToken.value;
    this._value = valueToken ? valueToken.value : '';
    
    this._positions = {
      name: nameToken.start,
      value: valueToken ? valueToken.start : -1
    };
    
    this.initialize.apply(this, arguments);
  }
  
  /**
   * The self-propagating extend function for classes.
   * @type Function
   */
  EditElement.extend = core.extend;
  
  EditElement.prototype = {
    /**
     * Child class constructor
     */
    initialize: function() {},
    
    /**
     * Make position absolute
     * @private
     * @param {Number} num
     * @param {Boolean} isAbsolute
     * @returns {Boolean}
     */
    _pos: function(num, isAbsolute) {
      return num + (isAbsolute ? this.parent.options.offset : 0);
    },
      
    /**
     * Sets of gets element value
     * @param {String} val New element value. If not passed, current 
     * value is returned
     * @returns {String}
     */
    value: function(val) {
      if (!_.isUndefined(val) && this._value !== (val = String(val))) {
        this.parent._updateSource(val, this.valueRange());
        this._value = val;
      }
      
      return this._value;
    },
    
    /**
     * Sets of gets element name
     * @param {String} val New element name. If not passed, current 
     * name is returned
     * @returns {String}
     */
    name: function(val) {
      if (!_.isUndefined(val) && this._name !== (val = String(val))) {
        this.parent._updateSource(val, this.nameRange());
        this._name = val;
      }
      
      return this._name;
    },
    
    /**
     * Returns position of element name token
     * @param {Boolean} isAbsolute Return absolute position
     * @returns {Number}
     */
    namePosition: function(isAbsolute) {
      return this._pos(this._positions.name, isAbsolute);
    },
    
    /**
     * Returns position of element value token
     * @param {Boolean} isAbsolute Return absolute position
     * @returns {Number}
     */
    valuePosition: function(isAbsolute) {
      return this._pos(this._positions.value, isAbsolute);
    },
    
    /**
     * Returns element name
     * @param {Boolean} isAbsolute Return absolute range 
     * @returns {Range}
     */
    range: function(isAbsolute) {
      return range(this.namePosition(isAbsolute), this.toString());
    },
    
    /**
     * Returns full element range, including possible indentation
     * @param {Boolean} isAbsolute Return absolute range
     * @returns {Range}
     */
    fullRange: function(isAbsolute) {
      return this.range(isAbsolute);
    },
    
    /**
     * Returns element name range
     * @param {Boolean} isAbsolute Return absolute range
     * @returns {Range}
     */
    nameRange: function(isAbsolute) {
      return range(this.namePosition(isAbsolute), this.name());
    },
    
    /**
     * Returns element value range
     * @param {Boolean} isAbsolute Return absolute range
     * @returns {Range}
     */
    valueRange: function(isAbsolute) {
      return range(this.valuePosition(isAbsolute), this.value());
    },
    
    /**
     * Returns current element string representation
     * @returns {String}
     */
    toString: function() {
      return this.name() + this.value();
    },
    
    valueOf: function() {
      return this.toString();
    }
  };
  
  return {
    EditContainer: EditContainer,
    EditElement: EditElement,
    
    /**
     * Creates token that can be fed to <code>EditElement</code>
     * @param {Number} start
     * @param {String} value
     * @param {String} type
     * @returns
     */
    createToken: function(start, value, type) {
      var obj = {
        start: start || 0,
        value: value || '',
        type: type
      };
      
      obj.end = obj.start + obj.value.length;
      return obj;
    }
  };
});/**
 * CSS EditTree is a module that can parse a CSS rule into a tree with 
 * convenient methods for adding, modifying and removing CSS properties. These 
 * changes can be written back to string with respect of code formatting.
 * 
 * @memberOf __cssEditTreeDefine
 * @constructor
 * @param {Function} require
 * @param {Underscore} _ 
 */
emmet.define('cssEditTree', function(require, _) {
  var defaultOptions = {
    styleBefore: '\n\t',
    styleSeparator: ': ',
    offset: 0
  };
  
  var WHITESPACE_REMOVE_FROM_START = 1;
  var WHITESPACE_REMOVE_FROM_END   = 2;
  
  /**
   * Returns range object
   * @param {Number} start
   * @param {Number} len 
   * @returns {Range}
   */
  function range(start, len) {
    return require('range').create(start, len);
  }
  
  /**
   * Removes whitespace tokens from the array ends
   * @param {Array} tokens
   * @param {Number} mask Mask indicating from which end whitespace should be 
   * removed 
   * @returns {Array}
   */
  function trimWhitespaceTokens(tokens, mask) {
    mask = mask || (WHITESPACE_REMOVE_FROM_START | WHITESPACE_REMOVE_FROM_END);
    var whitespace = ['white', 'line'];
    
    if ((mask & WHITESPACE_REMOVE_FROM_END) == WHITESPACE_REMOVE_FROM_END)
      while (tokens.length && _.include(whitespace, _.last(tokens).type)) {
        tokens.pop();
      }
    
    if ((mask & WHITESPACE_REMOVE_FROM_START) == WHITESPACE_REMOVE_FROM_START)
      while (tokens.length && _.include(whitespace, tokens[0].type)) {
        tokens.shift();
      }
    
    return tokens;
  }
  
  /**
   * Helper function that searches for selector range for <code>CSSEditRule</code>
   * @param {TokenIterator} it
   * @returns {Range}
   */
  function findSelectorRange(it) {
    var tokens = [], token;
    var start = it.position(), end;
    
    while (token = it.next()) {
      if (token.type == '{')
        break;
      tokens.push(token);
    }
    
    trimWhitespaceTokens(tokens);
    
    if (tokens.length) {
      start = tokens[0].start;
      end = _.last(tokens).end;
    } else {
      end = start;
    }
    
    return range(start, end - start);
  }
  
  /**
   * Helper function that searches for CSS property value range next to
   * iterator's current position  
   * @param {TokenIterator} it
   * @returns {Range}
   */
  function findValueRange(it) {
    // find value start position
    var skipTokens = ['white', 'line', ':'];
    var tokens = [], token, start, end;
    
    it.nextUntil(function(tok) {
      return !_.include(skipTokens, this.itemNext().type);
    });
    
    start = it.current().end;
    // consume value
    while (token = it.next()) {
      if (token.type == '}' || token.type == ';') {
        // found value end
        trimWhitespaceTokens(tokens, WHITESPACE_REMOVE_FROM_START 
            | (token.type == '}' ? WHITESPACE_REMOVE_FROM_END : 0));
        
        if (tokens.length) {
          start = tokens[0].start;
          end = _.last(tokens).end;
        } else {
          end = start;
        }
        
        return range(start, end - start);
      }
      
      tokens.push(token);
    }
    
    // reached the end of tokens list
    if (tokens.length) {
      return range(tokens[0].start, _.last(tokens).end - tokens[0].start);
    }
  }
  
  /**
   * Finds parts of complex CSS value
   * @param {String} str
   * @returns {Array} Returns list of <code>Range</code>'s
   */
  function findParts(str) {
    /** @type StringStream */
    var stream = require('stringStream').create(str);
    var ch;
    var result = [];
    var sep = /[\s\u00a0,]/;
    
    var add = function() {
      stream.next();
      result.push(range(stream.start, stream.current()));
      stream.start = stream.pos;
    };
    
    // skip whitespace
    stream.eatSpace();
    stream.start = stream.pos;
    
    while (ch = stream.next()) {
      if (ch == '"' || ch == "'") {
        stream.next();
        if (!stream.skipTo(ch)) break;
        add();
      } else if (ch == '(') {
        // function found, may have nested function
        stream.backUp(1);
        if (!stream.skipToPair('(', ')')) break;
        stream.backUp(1);
        add();
      } else {
        if (sep.test(ch)) {
          result.push(range(stream.start, stream.current().length - 1));
          stream.eatWhile(sep);
          stream.start = stream.pos;
        }
      }
    }
    
    add();
    
    return _.chain(result)
      .filter(function(item) {
        return !!item.length();
      })
      .uniq(false, function(item) {
        return item.toString();
      })
      .value();
  }
  
  /**
   * A bit hacky way to identify invalid CSS property definition: when user
   * starts writing new abbreviation in CSS rule, he actually creates invalid
   * CSS property definition and this method tries to identify such abbreviation
   * and prevent it from being added to CSS edit tree 
   * @param {TokenIterator} it
   */
  function isValidIdentifier(it) {
//    return true;
    var tokens = it.tokens;
    for (var i = it._i + 1, il = tokens.length; i < il; i++) {
      if (tokens[i].type == ':')
        return true;
      
      if (tokens[i].type == 'identifier' || tokens[i].type == 'line')
        return false;
    }
    
    return false;
  }
  
  /**
   * @class
   * @extends EditContainer
   */
  var CSSEditContainer = require('editTree').EditContainer.extend({
    initialize: function(source, options) {
      _.defaults(this.options, defaultOptions);
      var editTree = require('editTree');
      
      /** @type TokenIterator */
      var it = require('tokenIterator').create(
          require('cssParser').parse(source));
      
      var selectorRange = findSelectorRange(it);
      this._positions.name = selectorRange.start;
      this._name = selectorRange.substring(source);
      
      if (!it.current() || it.current().type != '{')
        throw 'Invalid CSS rule';
      
      this._positions.contentStart = it.position() + 1;
      
      // consume properties
      var propertyRange, valueRange, token;
      while (token = it.next()) {
        if (token.type == 'identifier' && isValidIdentifier(it)) {
          propertyRange = range(token);
          valueRange = findValueRange(it);
          var end = (it.current() && it.current().type == ';') 
            ? range(it.current())
            : range(valueRange.end, 0);
          this._children.push(new CSSEditElement(this,
              editTree.createToken(propertyRange.start, propertyRange.substring(source)),
              editTree.createToken(valueRange.start, valueRange.substring(source)),
              editTree.createToken(end.start, end.substring(source))
              ));
        }
      }
      
      this._saveStyle();
    },
    
    /**
     * Remembers all styles of properties
     * @private
     */
    _saveStyle: function() {
      var start = this._positions.contentStart;
      var source = this.source;
      var utils = require('utils');
      
      _.each(this.list(), /** @param {CSSEditProperty} p */ function(p) {
        p.styleBefore = source.substring(start, p.namePosition());
        // a small hack here:
        // Sometimes users add empty lines before properties to logically
        // separate groups of properties. In this case, a blind copy of
        // characters between rules may lead to undesired behavior,
        // especially when current rule is duplicated or used as a donor
        // to create new rule.
        // To solve this issue, we‘ll take only last newline indentation
        var lines = utils.splitByLines(p.styleBefore);
        if (lines.length > 1) {
          p.styleBefore = '\n' + _.last(lines);
        }
        
        p.styleSeparator = source.substring(p.nameRange().end, p.valuePosition());
        
        // graceful and naive comments removal 
        p.styleBefore = _.last(p.styleBefore.split('*/'));
        p.styleSeparator = p.styleSeparator.replace(/\/\*.*?\*\//g, '');
        
        start = p.range().end;
      });
    },
    
    /**
     * Adds new CSS property 
     * @param {String} name Property name
     * @param {String} value Property value
     * @param {Number} pos Position at which to insert new property. By 
     * default the property is inserted at the end of rule 
     * @returns {CSSEditProperty}
     */
    add: function(name, value, pos) {
      var list = this.list();
      var start = this._positions.contentStart;
      var styles = _.pick(this.options, 'styleBefore', 'styleSeparator');
      var editTree = require('editTree');
      
      if (_.isUndefined(pos))
        pos = list.length;
      
      /** @type CSSEditProperty */
      var donor = list[pos];
      if (donor) {
        start = donor.fullRange().start;
      } else if (donor = list[pos - 1]) {
        // make sure that donor has terminating semicolon
        donor.end(';');
        start = donor.range().end;
      }
      
      if (donor) {
        styles = _.pick(donor, 'styleBefore', 'styleSeparator');
      }
      
      var nameToken = editTree.createToken(start + styles.styleBefore.length, name);
      var valueToken = editTree.createToken(nameToken.end + styles.styleSeparator.length, value);
      
      var property = new CSSEditElement(this, nameToken, valueToken,
          editTree.createToken(valueToken.end, ';'));
      
      _.extend(property, styles);
      
      // write new property into the source
      this._updateSource(property.styleBefore + property.toString(), start);
      
      // insert new property
      this._children.splice(pos, 0, property);
      return property;
    }
  });
  
  /**
   * @class
   * @type CSSEditElement
   * @constructor
   */
  var CSSEditElement = require('editTree').EditElement.extend({
    initialize: function(rule, name, value, end) {
      this.styleBefore = rule.options.styleBefore;
      this.styleSeparator = rule.options.styleSeparator;
      
      this._end = end.value;
      this._positions.end = end.start;
    },
    
    /**
     * Returns ranges of complex value parts
     * @returns {Array} Returns <code>null</code> if value is not complex
     */
    valueParts: function(isAbsolute) {
      var parts = findParts(this.value());
      if (isAbsolute) {
        var offset = this.valuePosition(true);
        _.each(parts, function(p) {
          p.shift(offset);
        });
      }
      
      return parts;
    },
    
    /**
     * Sets of gets property end value (basically, it's a semicolon)
     * @param {String} val New end value. If not passed, current 
     * value is returned
     */
    end: function(val) {
      if (!_.isUndefined(val) && this._end !== val) {
        this.parent._updateSource(val, this._positions.end, this._positions.end + this._end.length);
        this._end = val;
      }
      
      return this._end;
    },
    
    /**
     * Returns full rule range, with indentation
     * @param {Boolean} isAbsolute Return absolute range (with respect of
     * rule offset)
     * @returns {Range}
     */
    fullRange: function(isAbsolute) {
      var r = this.range(isAbsolute);
      r.start -= this.styleBefore.length;
      return r;
    },
    
    /**
     * Returns item string representation
     * @returns {String}
     */
    toString: function() {
      return this.name() + this.styleSeparator + this.value() + this.end();
    }
  });
  
  return {
    /**
     * Parses CSS rule into editable tree
     * @param {String} source
     * @param {Object} options
     * @memberOf emmet.cssEditTree
     * @returns {EditContainer}
     */
    parse: function(source, options) {
      return new CSSEditContainer(source, options);
    },
    
    /**
     * Extract and parse CSS rule from specified position in <code>content</code> 
     * @param {String} content CSS source code
     * @param {Number} pos Character position where to start source code extraction
     * @returns {EditContainer}
     */
    parseFromPosition: function(content, pos, isBackward) {
      var bounds = this.extractRule(content, pos, isBackward);
      if (!bounds || !bounds.inside(pos))
        // no matching CSS rule or caret outside rule bounds
        return null;
      
      return this.parse(bounds.substring(content), {
        offset: bounds.start
      });
    },
    
    /**
     * Extracts single CSS selector definition from source code
     * @param {String} content CSS source code
     * @param {Number} pos Character position where to start source code extraction
     * @returns {Range}
     */
    extractRule: function(content, pos, isBackward) {
      var result = '';
      var len = content.length;
      var offset = pos;
      var stopChars = '{}/\\<>\n\r';
      var bracePos = -1, ch;
      
      // search left until we find rule edge
      while (offset >= 0) {
        ch = content.charAt(offset);
        if (ch == '{') {
          bracePos = offset;
          break;
        }
        else if (ch == '}' && !isBackward) {
          offset++;
          break;
        }
        
        offset--;
      }
      
      // search right for full rule set
      while (offset < len) {
        ch = content.charAt(offset);
        if (ch == '{') {
          bracePos = offset;
        } else if (ch == '}') {
          if (bracePos != -1)
            result = content.substring(bracePos, offset + 1);
          break;
        }
        
        offset++;
      }
      
      if (result) {
        // find CSS selector
        offset = bracePos - 1;
        var selector = '';
        while (offset >= 0) {
          ch = content.charAt(offset);
          if (stopChars.indexOf(ch) != -1) break;
          offset--;
        }
        
        // also trim whitespace
        selector = content.substring(offset + 1, bracePos).replace(/^[\s\n\r]+/m, '');
        return require('range').create(bracePos - selector.length, result.length + selector.length);
      }
      
      return null;
    },
    
    /**
     * Removes vendor prefix from CSS property
     * @param {String} name CSS property
     * @return {String}
     */
    baseName: function(name) {
      return name.replace(/^\s*\-\w+\-/, '');
    },
    
    /**
     * Finds parts of complex CSS value
     * @param {String} str
     * @returns {Array}
     */
    findParts: findParts
  };
});/**
 * XML EditTree is a module that can parse an XML/HTML element into a tree with 
 * convenient methods for adding, modifying and removing attributes. These 
 * changes can be written back to string with respect of code formatting.
 * 
 * @memberOf __xmlEditTreeDefine
 * @constructor
 * @param {Function} require
 * @param {Underscore} _ 
 */
emmet.define('xmlEditTree', function(require, _) {
  var defaultOptions = {
    styleBefore: ' ',
    styleSeparator: '=',
    styleQuote: '"',
    offset: 0
  };
  
  var startTag = /^<([\w\:\-]+)((?:\s+[\w\-:]+(?:\s*=\s*(?:(?:"[^"]*")|(?:'[^']*')|[^>\s]+))?)*)\s*(\/?)>/m;
  
  var XMLEditContainer = require('editTree').EditContainer.extend({
    initialize: function(source, options) {
      _.defaults(this.options, defaultOptions);
      this._positions.name = 1;
      
      var attrToken = null;
      var tokens = require('xmlParser').parse(source);
      var range = require('range');
      
      _.each(tokens, function(token) {
        token.value = range.create(token).substring(source);
        switch (token.type) {
          case 'tag':
            if (/^<[^\/]+/.test(token.value)) {
              this._name = token.value.substring(1);
            }
            break;
            
          case 'attribute':
            // add empty attribute
            if (attrToken) {
              this._children.push(new XMLEditElement(this, attrToken));
            }
            
            attrToken = token;
            break;
            
          case 'string':
            this._children.push(new XMLEditElement(this, attrToken, token));
            attrToken = null;
            break;
        }
      }, this);
      
      if (attrToken) {
        this._children.push(new XMLEditElement(this, attrToken));
      }
      
      this._saveStyle();
    },
    
    /**
     * Remembers all styles of properties
     * @private
     */
    _saveStyle: function() {
      var start = this.nameRange().end;
      var source = this.source;
      
      _.each(this.list(), /** @param {EditElement} p */ function(p) {
        p.styleBefore = source.substring(start, p.namePosition());
        
        if (p.valuePosition() !== -1) {
          p.styleSeparator = source.substring(p.namePosition() + p.name().length, p.valuePosition() - p.styleQuote.length);
        }
        
        start = p.range().end;
      });
    },
    
    /**
     * Adds new attribute 
     * @param {String} name Property name
     * @param {String} value Property value
     * @param {Number} pos Position at which to insert new property. By 
     * default the property is inserted at the end of rule 
     */
    add: function(name, value, pos) {
      var list = this.list();
      var start = this.nameRange().end;
      var editTree = require('editTree');
      var styles = _.pick(this.options, 'styleBefore', 'styleSeparator', 'styleQuote');
      
      if (_.isUndefined(pos))
        pos = list.length;
      
      
      /** @type XMLEditAttribute */
      var donor = list[pos];
      if (donor) {
        start = donor.fullRange().start;
      } else if (donor = list[pos - 1]) {
        start = donor.range().end;
      }
      
      if (donor) {
        styles = _.pick(donor, 'styleBefore', 'styleSeparator', 'styleQuote');
      }
      
      value = styles.styleQuote + value + styles.styleQuote;
      
      var attribute = new XMLEditElement(this, 
          editTree.createToken(start + styles.styleBefore.length, name),
          editTree.createToken(start + styles.styleBefore.length + name.length 
              + styles.styleSeparator.length, value)
          );
      
      _.extend(attribute, styles);
      
      // write new attribute into the source
      this._updateSource(attribute.styleBefore + attribute.toString(), start);
      
      // insert new attribute
      this._children.splice(pos, 0, attribute);
      return attribute;
    }
  });
  
  var XMLEditElement = require('editTree').EditElement.extend({
    initialize: function(parent, nameToken, valueToken) {
      this.styleBefore = parent.options.styleBefore;
      this.styleSeparator = parent.options.styleSeparator;
      
      var value = '', quote = parent.options.styleQuote;
      if (valueToken) {
        value = valueToken.value;
        quote = value.charAt(0);
        if (quote == '"' || quote == "'") {
          value = value.substring(1);
        } else {
          quote = '';
        }
        
        if (quote && value.charAt(value.length - 1) == quote) {
          value = value.substring(0, value.length - 1);
        }
      }
      
      this.styleQuote = quote;
      
      this._value = value;
      this._positions.value = valueToken ? valueToken.start + quote.length : -1;
    },
    
    /**
     * Returns full rule range, with indentation
     * @param {Boolean} isAbsolute Return absolute range (with respect of
     * rule offset)
     * @returns {Range}
     */
    fullRange: function(isAbsolute) {
      var r = this.range(isAbsolute);
      r.start -= this.styleBefore.length;
      return r;
    },
    
    toString: function() {
      return this.name() + this.styleSeparator
        + this.styleQuote + this.value() + this.styleQuote;
    }
  });
  
  return {
    /**
     * Parses HTML element into editable tree
     * @param {String} source
     * @param {Object} options
     * @memberOf emmet.htmlEditTree
     * @returns {EditContainer}
     */
    parse: function(source, options) {
      return new XMLEditContainer(source, options);
    },
    
    /**
     * Extract and parse HTML from specified position in <code>content</code> 
     * @param {String} content CSS source code
     * @param {Number} pos Character position where to start source code extraction
     * @returns {XMLEditElement}
     */
    parseFromPosition: function(content, pos, isBackward) {
      var bounds = this.extractTag(content, pos, isBackward);
      if (!bounds || !bounds.inside(pos))
        // no matching HTML tag or caret outside tag bounds
        return null;
      
      return this.parse(bounds.substring(content), {
        offset: bounds.start
      });
    },
    
    /**
     * Extracts nearest HTML tag range from <code>content</code>, starting at 
     * <code>pos</code> position
     * @param {String} content
     * @param {Number} pos
     * @param {Boolean} isBackward
     * @returns {Range}
     */
    extractTag: function(content, pos, isBackward) {
      var len = content.length, i;
      var range = require('range');
      
      // max extraction length. I don't think there may be tags larger 
      // than 2000 characters length
      var maxLen = Math.min(2000, len);
      
      /** @type Range */
      var r = null;
      
      var match = function(pos) {
        var m;
        if (content.charAt(pos) == '<' && (m = content.substr(pos, maxLen).match(startTag)))
          return range.create(pos, m[0]);
      };
      
      // lookup backward, in case we are inside tag already
      for (i = pos; i >= 0; i--) {
        if (r = match(i)) break;
      }
      
      if (r && (r.inside(pos) || isBackward))
        return r;
      
      if (!r && isBackward)
        return null;
      
      // search forward
      for (i = pos; i < len; i++) {
        if (r = match(i))
          return r;
      }
    }
  };
});/**
 * 'Expand abbreviation' editor action: extracts abbreviation from current caret 
 * position and replaces it with formatted output. 
 * <br><br>
 * This behavior can be overridden with custom handlers which can perform 
 * different actions when 'Expand Abbreviation' action is called.
 * For example, a CSS gradient handler that produces vendor-prefixed gradient
 * definitions registers its own expand abbreviation handler.  
 *  
 * @constructor
 * @memberOf __expandAbbreviationActionDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('expandAbbreviation', function(require, _) {
  /**
   * @type HandlerList List of registered handlers
   */
  var handlers = require('handlerList').create();
  
  /** Back-reference to module */
  var module = null;
  
  var actions = require('actions');
  /**
   * 'Expand abbreviation' editor action 
   * @param {IEmmetEditor} editor Editor instance
   * @param {String} syntax Syntax type (html, css, etc.)
   * @param {String} profile Output profile name (html, xml, xhtml)
   * @return {Boolean} Returns <code>true</code> if abbreviation was expanded 
   * successfully
   */
  actions.add('expand_abbreviation', function(editor, syntax, profile) {
    var args = _.toArray(arguments);
    
    // normalize incoming arguments
    var info = require('editorUtils').outputInfo(editor, syntax, profile);
    args[1] = info.syntax;
    args[2] = info.profile;
    
    return handlers.exec(false, args);
  });
  
  /**
   * A special version of <code>expandAbbreviation</code> function: if it can't
   * find abbreviation, it will place Tab character at caret position
   * @param {IEmmetEditor} editor Editor instance
   * @param {String} syntax Syntax type (html, css, etc.)
   * @param {String} profile Output profile name (html, xml, xhtml)
   */
  actions.add('expand_abbreviation_with_tab', function(editor, syntax, profile) {
    var sel = editor.getSelection();
    var indent = require('resources').getVariable('indentation');
    if (sel) {
      // indent selection
      var utils = require('utils');
      var selRange = require('range').create(editor.getSelectionRange());
      var content = utils.padString(sel, indent);
      
      editor.replaceContent(indent + '${0}', editor.getCaretPos());
      var replaceRange = require('range').create(editor.getCaretPos(), selRange.length());
      editor.replaceContent(content, replaceRange.start, replaceRange.end, true);
      editor.createSelection(replaceRange.start, replaceRange.start + content.length);
      return true;
    }
    
    if (!actions.run('expand_abbreviation', editor, syntax, profile)) {
      editor.replaceContent(indent, editor.getCaretPos());
    }
    
    return true;
  }, {hidden: true});
  
  // XXX setup default handler
  /**
   * Extracts abbreviation from current caret 
   * position and replaces it with formatted output 
   * @param {IEmmetEditor} editor Editor instance
   * @param {String} syntax Syntax type (html, css, etc.)
   * @param {String} profile Output profile name (html, xml, xhtml)
   * @return {Boolean} Returns <code>true</code> if abbreviation was expanded 
   * successfully
   */
  handlers.add(function(editor, syntax, profile) {
    var caretPos = editor.getSelectionRange().end;
    var abbr = module.findAbbreviation(editor);
      
    if (abbr) {
      var content = emmet.expandAbbreviation(abbr, syntax, profile, 
          require('actionUtils').captureContext(editor));
      if (content) {
        editor.replaceContent(content, caretPos - abbr.length, caretPos);
        return true;
      }
    }
    
    return false;
  }, {order: -1});
  
  return module = {
    /**
     * Adds custom expand abbreviation handler. The passed function should 
     * return <code>true</code> if it was performed successfully, 
     * <code>false</code> otherwise.
     * 
     * Added handlers will be called when 'Expand Abbreviation' is called
     * in order they were added
     * @memberOf expandAbbreviation
     * @param {Function} fn
     * @param {Object} options
     */
    addHandler: function(fn, options) {
      handlers.add(fn, options);
    },
    
    /**
     * Removes registered handler
     * @returns
     */
    removeHandler: function(fn) {
      handlers.remove(fn, options);
    },
    
    /**
     * Search for abbreviation in editor from current caret position
     * @param {IEmmetEditor} editor Editor instance
     * @return {String}
     */
    findAbbreviation: function(editor) {
      /** @type Range */
      var range = require('range').create(editor.getSelectionRange());
      var content = String(editor.getContent());
      if (range.length()) {
        // abbreviation is selected by user
        return range.substring(content);
      }
      
      // search for new abbreviation from current caret position
      var curLine = editor.getCurrentLineRange();
      return require('actionUtils').extractAbbreviation(content.substring(curLine.start, range.start));
    }
  };
});/**
 * Action that wraps content with abbreviation. For convenience, action is 
 * defined as reusable module
 * @constructor
 * @memberOf __wrapWithAbbreviationDefine
 */
emmet.define('wrapWithAbbreviation', function(require, _) {
  /** Back-references to current module */
  var module = null;
  
  /**
   * Wraps content with abbreviation
   * @param {IEmmetEditor} Editor instance
   * @param {String} abbr Abbreviation to wrap with
   * @param {String} syntax Syntax type (html, css, etc.)
   * @param {String} profile Output profile name (html, xml, xhtml)
   */
  require('actions').add('wrap_with_abbreviation', function (editor, abbr, syntax, profile) {
    var info = require('editorUtils').outputInfo(editor, syntax, profile);
    var utils = require('utils');
    /** @type emmet.editorUtils */
    var editorUtils = require('editorUtils');
    abbr = abbr || editor.prompt("Enter abbreviation");
    
    if (!abbr) 
      return null;
    
    abbr = String(abbr);
    
    var range = require('range').create(editor.getSelectionRange());
    
    if (!range.length()) {
      // no selection, find tag pair
      var match = require('htmlMatcher').tag(info.content, range.start);
      if (!match) {  // nothing to wrap
        return false;
      }
      
      range = utils.narrowToNonSpace(info.content, match.range);
    }
    
    var newContent = utils.escapeText(range.substring(info.content));
    var result = module
      .wrap(abbr, editorUtils.unindent(editor, newContent), info.syntax, 
          info.profile, require('actionUtils').captureContext(editor));
    
    if (result) {
      editor.replaceContent(result, range.start, range.end);
      return true;
    }
    
    return false;
  });
  
  return module = {
    /**
     * Wraps passed text with abbreviation. Text will be placed inside last
     * expanded element
     * @memberOf wrapWithAbbreviation
     * @param {String} abbr Abbreviation
     * @param {String} text Text to wrap
     * @param {String} syntax Document type (html, xml, etc.). Default is 'html'
     * @param {String} profile Output profile's name. Default is 'plain'
     * @param {Object} contextNode Context node inside which abbreviation
     * is wrapped. It will be used as a reference for node name resolvers
     * @return {String}
     */
    wrap: function(abbr, text, syntax, profile, contextNode) {
      /** @type emmet.filters */
      var filters = require('filters');
      /** @type emmet.utils */
      var utils = require('utils');
      
      syntax = syntax || emmet.defaultSyntax();
      profile = require('profile').get(profile, syntax);
      
      require('tabStops').resetTabstopIndex();
      
      var data = filters.extractFromAbbreviation(abbr);
      var parsedTree = require('abbreviationParser').parse(data[0], {
        syntax: syntax,
        pastedContent: text,
        contextNode: contextNode
      });
      if (parsedTree) {
        var filtersList = filters.composeList(syntax, profile, data[1]);
        filters.apply(parsedTree, filtersList, profile);
        return utils.replaceVariables(parsedTree.toString());
      }
      
      return null;
    }
  };
});/**
 * Toggles HTML and CSS comments depending on current caret context. Unlike
 * the same action in most editors, this action toggles comment on currently
 * matched item—HTML tag or CSS selector—when nothing is selected.
 * 
 * @param {Function} require
 * @param {Underscore} _
 * @memberOf __toggleCommentAction
 * @constructor
 */
emmet.exec(function(require, _) {
  /**
   * Toggle HTML comment on current selection or tag
   * @param {IEmmetEditor} editor
   * @return {Boolean} Returns <code>true</code> if comment was toggled
   */
  function toggleHTMLComment(editor) {
    /** @type Range */
    var range = require('range').create(editor.getSelectionRange());
    var info = require('editorUtils').outputInfo(editor);
      
    if (!range.length()) {
      // no selection, find matching tag
      var tag = require('htmlMatcher').tag(info.content, editor.getCaretPos());
      if (tag) { // found pair
        range = tag.outerRange;
      }
    }
    
    return genericCommentToggle(editor, '<!--', '-->', range);
  }

  /**
   * Simple CSS commenting
   * @param {IEmmetEditor} editor
   * @return {Boolean} Returns <code>true</code> if comment was toggled
   */
  function toggleCSSComment(editor) {
    /** @type Range */
    var range = require('range').create(editor.getSelectionRange());
    var info = require('editorUtils').outputInfo(editor);
      
    if (!range.length()) {
      // no selection, try to get current rule
      /** @type CSSRule */
      var rule = require('cssEditTree').parseFromPosition(info.content, editor.getCaretPos());
      if (rule) {
        var property = cssItemFromPosition(rule, editor.getCaretPos());
        range = property 
          ? property.range(true) 
          : require('range').create(rule.nameRange(true).start, rule.source);
      }
    }
    
    if (!range.length()) {
      // still no selection, get current line
      range = require('range').create(editor.getCurrentLineRange());
      require('utils').narrowToNonSpace(info.content, range);
    }
    
    return genericCommentToggle(editor, '/*', '*/', range);
  }
  
  /**
   * Returns CSS property from <code>rule</code> that matches passed position
   * @param {EditContainer} rule
   * @param {Number} absPos
   * @returns {EditElement}
   */
  function cssItemFromPosition(rule, absPos) {
    // do not use default EditContainer.itemFromPosition() here, because
    // we need to make a few assumptions to make CSS commenting more reliable
    var relPos = absPos - (rule.options.offset || 0);
    var reSafeChar = /^[\s\n\r]/;
    return _.find(rule.list(), function(item) {
      if (item.range().end === relPos) {
        // at the end of property, but outside of it
        // if there’s a space character at current position,
        // use current property
        return reSafeChar.test(rule.source.charAt(relPos));
      }
      
      return item.range().inside(relPos);
    });
  }

  /**
   * Search for nearest comment in <code>str</code>, starting from index <code>from</code>
   * @param {String} text Where to search
   * @param {Number} from Search start index
   * @param {String} start_token Comment start string
   * @param {String} end_token Comment end string
   * @return {Range} Returns null if comment wasn't found
   */
  function searchComment(text, from, startToken, endToken) {
    var commentStart = -1;
    var commentEnd = -1;
    
    var hasMatch = function(str, start) {
      return text.substr(start, str.length) == str;
    };
      
    // search for comment start
    while (from--) {
      if (hasMatch(startToken, from)) {
        commentStart = from;
        break;
      }
    }
    
    if (commentStart != -1) {
      // search for comment end
      from = commentStart;
      var contentLen = text.length;
      while (contentLen >= from++) {
        if (hasMatch(endToken, from)) {
          commentEnd = from + endToken.length;
          break;
        }
      }
    }
    
    return (commentStart != -1 && commentEnd != -1) 
      ? require('range').create(commentStart, commentEnd - commentStart) 
      : null;
  }

  /**
   * Generic comment toggling routine
   * @param {IEmmetEditor} editor
   * @param {String} commentStart Comment start token
   * @param {String} commentEnd Comment end token
   * @param {Range} range Selection range
   * @return {Boolean}
   */
  function genericCommentToggle(editor, commentStart, commentEnd, range) {
    var editorUtils = require('editorUtils');
    var content = editorUtils.outputInfo(editor).content;
    var caretPos = editor.getCaretPos();
    var newContent = null;
    
    var utils = require('utils');
      
    /**
     * Remove comment markers from string
     * @param {Sting} str
     * @return {String}
     */
    function removeComment(str) {
      return str
        .replace(new RegExp('^' + utils.escapeForRegexp(commentStart) + '\\s*'), function(str){
          caretPos -= str.length;
          return '';
        }).replace(new RegExp('\\s*' + utils.escapeForRegexp(commentEnd) + '$'), '');
    }
    
    // first, we need to make sure that this substring is not inside 
    // comment
    var commentRange = searchComment(content, caretPos, commentStart, commentEnd);
    if (commentRange && commentRange.overlap(range)) {
      // we're inside comment, remove it
      range = commentRange;
      newContent = removeComment(range.substring(content));
    } else {
      // should add comment
      // make sure that there's no comment inside selection
      newContent = commentStart + ' ' +
        range.substring(content)
          .replace(new RegExp(utils.escapeForRegexp(commentStart) + '\\s*|\\s*' + utils.escapeForRegexp(commentEnd), 'g'), '') +
        ' ' + commentEnd;
        
      // adjust caret position
      caretPos += commentStart.length + 1;
    }

    // replace editor content
    if (newContent !== null) {
      newContent = utils.escapeText(newContent);
      editor.setCaretPos(range.start);
      editor.replaceContent(editorUtils.unindent(editor, newContent), range.start, range.end);
      editor.setCaretPos(caretPos);
      return true;
    }
    
    return false;
  }
  
  /**
   * Toggle comment on current editor's selection or HTML tag/CSS rule
   * @param {IEmmetEditor} editor
   */
  require('actions').add('toggle_comment', function(editor) {
    var info = require('editorUtils').outputInfo(editor);
    if (info.syntax == 'css') {
      // in case our editor is good enough and can recognize syntax from 
      // current token, we have to make sure that cursor is not inside
      // 'style' attribute of html element
      var caretPos = editor.getCaretPos();
      var tag = require('htmlMatcher').tag(info.content, caretPos);
      if (tag && tag.open.range.inside(caretPos)) {
        info.syntax = 'html';
      }
    }
    
    if (info.syntax == 'css')
      return toggleCSSComment(editor);
    
    return toggleHTMLComment(editor);
  });
});/**
 * Move between next/prev edit points. 'Edit points' are places between tags 
 * and quotes of empty attributes in html
 * @constructor
 * 
 * @memberOf __editPointActionDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  /**
   * Search for new caret insertion point
   * @param {IEmmetEditor} editor Editor instance
   * @param {Number} inc Search increment: -1 — search left, 1 — search right
   * @param {Number} offset Initial offset relative to current caret position
   * @return {Number} Returns -1 if insertion point wasn't found
   */
  function findNewEditPoint(editor, inc, offset) {
    inc = inc || 1;
    offset = offset || 0;
    
    var curPoint = editor.getCaretPos() + offset;
    var content = String(editor.getContent());
    var maxLen = content.length;
    var nextPoint = -1;
    var reEmptyLine = /^\s+$/;
    
    function getLine(ix) {
      var start = ix;
      while (start >= 0) {
        var c = content.charAt(start);
        if (c == '\n' || c == '\r')
          break;
        start--;
      }
      
      return content.substring(start, ix);
    }
      
    while (curPoint <= maxLen && curPoint >= 0) {
      curPoint += inc;
      var curChar = content.charAt(curPoint);
      var nextChar = content.charAt(curPoint + 1);
      var prevChar = content.charAt(curPoint - 1);
        
      switch (curChar) {
        case '"':
        case '\'':
          if (nextChar == curChar && prevChar == '=') {
            // empty attribute
            nextPoint = curPoint + 1;
          }
          break;
        case '>':
          if (nextChar == '<') {
            // between tags
            nextPoint = curPoint + 1;
          }
          break;
        case '\n':
        case '\r':
          // empty line
          if (reEmptyLine.test(getLine(curPoint - 1))) {
            nextPoint = curPoint;
          }
          break;
      }
      
      if (nextPoint != -1)
        break;
    }
    
    return nextPoint;
  }
  
  /** @type emmet.actions */
  var actions = require('actions');
  
  /**
   * Move caret to previous edit point
   * @param {IEmmetEditor} editor Editor instance
   */
  actions.add('prev_edit_point', function(editor) {
    var curPos = editor.getCaretPos();
    var newPoint = findNewEditPoint(editor, -1);
      
    if (newPoint == curPos)
      // we're still in the same point, try searching from the other place
      newPoint = findNewEditPoint(editor, -1, -2);
    
    if (newPoint != -1) {
      editor.setCaretPos(newPoint);
      return true;
    }
    
    return false;
  }, {label: 'Previous Edit Point'});
  
  /**
   * Move caret to next edit point
   * @param {IEmmetEditor} editor Editor instance
   */
  actions.add('next_edit_point', function(editor) {
    var newPoint = findNewEditPoint(editor, 1);
    if (newPoint != -1) {
      editor.setCaretPos(newPoint);
      return true;
    }
    
    return false;
  });
});/**
 * Actions that use stream parsers and tokenizers for traversing:
 * -- Search for next/previous items in HTML
 * -- Search for next/previous items in CSS
 * @constructor
 * @memberOf __selectItemActionDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  var startTag = /^<([\w\:\-]+)((?:\s+[\w\-:]+(?:\s*=\s*(?:(?:"[^"]*")|(?:'[^']*')|[^>\s]+))?)*)\s*(\/?)>/;
  
  /**
   * Generic function for searching for items to select
   * @param {IEmmetEditor} editor
   * @param {Boolean} isBackward Search backward (search forward otherwise)
   * @param {Function} extractFn Function that extracts item content
   * @param {Function} rangeFn Function that search for next token range
   */
  function findItem(editor, isBackward, extractFn, rangeFn) {
    var range = require('range');
    var content = require('editorUtils').outputInfo(editor).content;
    
    var contentLength = content.length;
    var itemRange, rng;
    /** @type Range */
    var prevRange = range.create(-1, 0);
    /** @type Range */
    var sel = range.create(editor.getSelectionRange());
    
    var searchPos = sel.start, loop = 100000; // endless loop protection
    while (searchPos >= 0 && searchPos < contentLength && --loop > 0) {
      if ( (itemRange = extractFn(content, searchPos, isBackward)) ) {
        if (prevRange.equal(itemRange)) {
          break;
        }
        
        prevRange = itemRange.clone();
        rng = rangeFn(itemRange.substring(content), itemRange.start, sel.clone());
        
        if (rng) {
          editor.createSelection(rng.start, rng.end);
          return true;
        } else {
          searchPos = isBackward ? itemRange.start : itemRange.end - 1;
        }
      }
      
      searchPos += isBackward ? -1 : 1;
    }
    
    return false;
  }
  
  // XXX HTML section
  
  /**
   * Find next HTML item
   * @param {IEmmetEditor} editor
   */
  function findNextHTMLItem(editor) {
    var isFirst = true;
    return findItem(editor, false, function(content, searchPos){
      if (isFirst) {
        isFirst = false;
        return findOpeningTagFromPosition(content, searchPos);
      } else {
        return getOpeningTagFromPosition(content, searchPos);
      }
    }, function(tag, offset, selRange) {
      return getRangeForHTMLItem(tag, offset, selRange, false);
    });
  }
  
  /**
   * Find previous HTML item
   * @param {IEmmetEditor} editor
   */
  function findPrevHTMLItem(editor) {
    return findItem(editor, true, getOpeningTagFromPosition, function (tag, offset, selRange) {
      return getRangeForHTMLItem(tag, offset, selRange, true);
    });
  }
  
  /**
   * Creates possible selection ranges for HTML tag
   * @param {String} source Original HTML source for tokens
   * @param {Array} tokens List of HTML tokens
   * @returns {Array}
   */
  function makePossibleRangesHTML(source, tokens, offset) {
    offset = offset || 0;
    var range = require('range');
    var result = [];
    var attrStart = -1, attrName = '', attrValue = '', attrValueRange, tagName;
    _.each(tokens, function(tok) {
      switch (tok.type) {
        case 'tag':
          tagName = source.substring(tok.start, tok.end);
          if (/^<[\w\:\-]/.test(tagName)) {
            // add tag name
            result.push(range.create({
              start: tok.start + 1, 
              end: tok.end
            }));
          }
          break;
        case 'attribute':
          attrStart = tok.start;
          attrName = source.substring(tok.start, tok.end);
          break;
          
        case 'string':
          // attribute value
          // push full attribute first
           result.push(range.create(attrStart, tok.end - attrStart));
           
           attrValueRange = range.create(tok);
           attrValue = attrValueRange.substring(source);
           
           // is this a quoted attribute?
           if (isQuote(attrValue.charAt(0)))
             attrValueRange.start++;
           
           if (isQuote(attrValue.charAt(attrValue.length - 1)))
             attrValueRange.end--;
           
           result.push(attrValueRange);
           
           if (attrName == 'class') {
             result = result.concat(classNameRanges(attrValueRange.substring(source), attrValueRange.start));
           }
           
          break;
      }
    });
    
    // offset ranges
    _.each(result, function(r) {
      r.shift(offset);
    });
    
    return _.chain(result)
      .filter(function(item) {        // remove empty
        return !!item.length();
      })
      .uniq(false, function(item) {   // remove duplicates
        return item.toString();
      })
      .value();
  }
  
  /**
   * Returns ranges of class names in "class" attribute value
   * @param {String} className
   * @returns {Array}
   */
  function classNameRanges(className, offset) {
    offset = offset || 0;
    var result = [];
    /** @type StringStream */
    var stream = require('stringStream').create(className);
    var range = require('range');
    
    // skip whitespace
    stream.eatSpace();
    stream.start = stream.pos;
    
    var ch;
    while (ch = stream.next()) {
      if (/[\s\u00a0]/.test(ch)) {
        result.push(range.create(stream.start + offset, stream.pos - stream.start - 1));
        stream.eatSpace();
        stream.start = stream.pos;
      }
    }
    
    result.push(range.create(stream.start + offset, stream.pos - stream.start));
    return result;
  }
  
  /**
   * Returns best HTML tag range match for current selection
   * @param {String} tag Tag declaration
   * @param {Number} offset Tag's position index inside content
   * @param {Range} selRange Selection range
   * @return {Range} Returns range if next item was found, <code>null</code> otherwise
   */
  function getRangeForHTMLItem(tag, offset, selRange, isBackward) {
    var ranges = makePossibleRangesHTML(tag, require('xmlParser').parse(tag), offset);
    
    if (isBackward)
      ranges.reverse();
    
    // try to find selected range
    var curRange = _.find(ranges, function(r) {
      return r.equal(selRange);
    });
    
    if (curRange) {
      var ix = _.indexOf(ranges, curRange);
      if (ix < ranges.length - 1)
        return ranges[ix + 1];
      
      return null;
    }
    
    // no selected range, find nearest one
    if (isBackward)
      // search backward
      return _.find(ranges, function(r) {
        return r.start < selRange.start;
      });
    
    // search forward
    // to deal with overlapping ranges (like full attribute definition
    // and attribute value) let's find range under caret first
    if (!curRange) {
      var matchedRanges = _.filter(ranges, function(r) {
        return r.inside(selRange.end);
      });
      
      if (matchedRanges.length > 1)
        return matchedRanges[1];
    }
    
    
    return _.find(ranges, function(r) {
      return r.end > selRange.end;
    });
  }
  
  /**
   * Search for opening tag in content, starting at specified position
   * @param {String} html Where to search tag
   * @param {Number} pos Character index where to start searching
   * @return {Range} Returns range if valid opening tag was found,
   * <code>null</code> otherwise
   */
  function findOpeningTagFromPosition(html, pos) {
    var tag;
    while (pos >= 0) {
      if (tag = getOpeningTagFromPosition(html, pos))
        return tag;
      pos--;
    }
    
    return null;
  }
  
  /**
   * @param {String} html Where to search tag
   * @param {Number} pos Character index where to start searching
   * @return {Range} Returns range if valid opening tag was found,
   * <code>null</code> otherwise
   */
  function getOpeningTagFromPosition(html, pos) {
    var m;
    if (html.charAt(pos) == '<' && (m = html.substring(pos, html.length).match(startTag))) {
      return require('range').create(pos, m[0]);
    }
  }
  
  function isQuote(ch) {
    return ch == '"' || ch == "'";
  }
  
  /**
   * Makes all possible selection ranges for specified CSS property
   * @param {CSSProperty} property
   * @returns {Array}
   */
  function makePossibleRangesCSS(property) {
    // find all possible ranges, sorted by position and size
    var valueRange = property.valueRange(true);
    var result = [property.range(true), valueRange];
    var stringStream = require('stringStream');
    var cssEditTree = require('cssEditTree');
    var range = require('range');
    
    // locate parts of complex values.
    // some examples:
    // – 1px solid red: 3 parts
    // – arial, sans-serif: enumeration, 2 parts
    // – url(image.png): function value part
    var value = property.value();
    _.each(property.valueParts(), function(r) {
      // add absolute range
      var clone = r.clone();
      result.push(clone.shift(valueRange.start));
      
      /** @type StringStream */
      var stream = stringStream.create(r.substring(value));
      if (stream.match(/^[\w\-]+\(/, true)) {
        // we have a function, find values in it.
        // but first add function contents
        stream.start = stream.pos;
        stream.skipToPair('(', ')');
        var fnBody = stream.current();
        result.push(range.create(clone.start + stream.start, fnBody));
        
        // find parts
        _.each(cssEditTree.findParts(fnBody), function(part) {
          result.push(range.create(clone.start + stream.start + part.start, part.substring(fnBody)));
        });
      }
    });
    
    // optimize result: remove empty ranges and duplicates
    return _.chain(result)
      .filter(function(item) {
        return !!item.length();
      })
      .uniq(false, function(item) {
        return item.toString();
      })
      .value();
  }
  
  /**
   * Tries to find matched CSS property and nearest range for selection
   * @param {CSSRule} rule
   * @param {Range} selRange
   * @param {Boolean} isBackward
   * @returns {Range}
   */
  function matchedRangeForCSSProperty(rule, selRange, isBackward) {
    /** @type CSSProperty */
    var property = null;
    var possibleRanges, curRange = null, ix;
    var list = rule.list();
    var searchFn, nearestItemFn;
    
    if (isBackward) {
      list.reverse();
      searchFn = function(p) {
        return p.range(true).start <= selRange.start;
      };
      nearestItemFn = function(r) {
        return r.start < selRange.start;
      };
    } else {
      searchFn = function(p) {
        return p.range(true).end >= selRange.end;
      };
      nearestItemFn = function(r) {
        return r.end > selRange.start;
      };
    }
    
    // search for nearest to selection CSS property
    while (property = _.find(list, searchFn)) {
      possibleRanges = makePossibleRangesCSS(property);
      if (isBackward)
        possibleRanges.reverse();
      
      // check if any possible range is already selected
      curRange = _.find(possibleRanges, function(r) {
        return r.equal(selRange);
      });
      
      if (!curRange) {
        // no selection, select nearest item
        var matchedRanges = _.filter(possibleRanges, function(r) {
          return r.inside(selRange.end);
        });
        
        if (matchedRanges.length > 1) {
          curRange = matchedRanges[1];
          break;
        }
        
        if (curRange = _.find(possibleRanges, nearestItemFn))
          break;
      } else {
        ix = _.indexOf(possibleRanges, curRange);
        if (ix != possibleRanges.length - 1) {
          curRange = possibleRanges[ix + 1];
          break;
        }
      }
      
      curRange = null;
      selRange.start = selRange.end = isBackward 
        ? property.range(true).start - 1
        : property.range(true).end + 1;
    }
    
    return curRange;
  }
  
  function findNextCSSItem(editor) {
    return findItem(editor, false, require('cssEditTree').extractRule, getRangeForNextItemInCSS);
  }
  
  function findPrevCSSItem(editor) {
    return findItem(editor, true, require('cssEditTree').extractRule, getRangeForPrevItemInCSS);
  }
  
  /**
   * Returns range for item to be selected in CSS after current caret 
   * (selection) position
   * @param {String} rule CSS rule declaration
   * @param {Number} offset Rule's position index inside content
   * @param {Range} selRange Selection range
   * @return {Range} Returns range if next item was found, <code>null</code> otherwise
   */
  function getRangeForNextItemInCSS(rule, offset, selRange) {
    var tree = require('cssEditTree').parse(rule, {
      offset: offset
    });
    
    // check if selector is matched
    var range = tree.nameRange(true);
    if (selRange.end < range.end) {
      return range;
    }
    
    return matchedRangeForCSSProperty(tree, selRange, false);
  }
  
  /**
   * Returns range for item to be selected in CSS before current caret 
   * (selection) position
   * @param {String} rule CSS rule declaration
   * @param {Number} offset Rule's position index inside content
   * @param {Range} selRange Selection range
   * @return {Range} Returns range if previous item was found, <code>null</code> otherwise
   */
  function getRangeForPrevItemInCSS(rule, offset, selRange) {
    var tree = require('cssEditTree').parse(rule, {
      offset: offset
    });
    
    var curRange = matchedRangeForCSSProperty(tree, selRange, true);
    
    if (!curRange) {
      // no matched property, try to match selector
      var range = tree.nameRange(true);
      if (selRange.start > range.start) {
        return range;
      }
    }
    
    return curRange;
  }
  
  // XXX register actions
  var actions = require('actions');
  actions.add('select_next_item', function(editor){
    if (editor.getSyntax() == 'css')
      return findNextCSSItem(editor);
    else
      return findNextHTMLItem(editor);
  });
  
  actions.add('select_previous_item', function(editor){
    if (editor.getSyntax() == 'css')
      return findPrevCSSItem(editor);
    else
      return findPrevHTMLItem(editor);
  });
});/**
 * HTML pair matching (balancing) actions
 * @constructor
 * @memberOf __matchPairActionDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  /** @type emmet.actions */
  var actions = require('actions');
  var matcher = require('htmlMatcher');
  var lastMatch = null;
  
  /**
   * Find and select HTML tag pair
   * @param {IEmmetEditor} editor Editor instance
   * @param {String} direction Direction of pair matching: 'in' or 'out'. 
   * Default is 'out'
   */
  function matchPair(editor, direction) {
    direction = String((direction || 'out').toLowerCase());
    var info = require('editorUtils').outputInfo(editor);
    
    var range = require('range');
    /** @type Range */
    var sel = range.create(editor.getSelectionRange());
    var content = info.content;
    
    // validate previous match
    if (lastMatch && !lastMatch.range.equal(sel)) {
      lastMatch = null;
    }
    
    if (lastMatch && sel.length()) {
      if (direction == 'in') {
        // user has previously selected tag and wants to move inward
        if (lastMatch.type == 'tag' && !lastMatch.close) {
          // unary tag was selected, can't move inward
          return false;
        } else {
          if (lastMatch.range.equal(lastMatch.outerRange)) {
            lastMatch.range = lastMatch.innerRange;
          } else {
            var narrowed = require('utils').narrowToNonSpace(content, lastMatch.innerRange);
            lastMatch = matcher.find(content, narrowed.start + 1);
            if (lastMatch && lastMatch.range.equal(sel) && lastMatch.outerRange.equal(sel)) {
              lastMatch.range = lastMatch.innerRange;
            }
          }
        }
      } else {
        if (
            !lastMatch.innerRange.equal(lastMatch.outerRange) 
            && lastMatch.range.equal(lastMatch.innerRange) 
            && sel.equal(lastMatch.range)) {
          lastMatch.range = lastMatch.outerRange;
        } else {
          lastMatch = matcher.find(content, sel.start);
          if (lastMatch && lastMatch.range.equal(sel) && lastMatch.innerRange.equal(sel)) {
            lastMatch.range = lastMatch.outerRange;
          }
        }
      }
    } else {
      lastMatch = matcher.find(content, sel.start);
    }
    
    if (lastMatch && !lastMatch.range.equal(sel)) {
      editor.createSelection(lastMatch.range.start, lastMatch.range.end);
      return true;
    }
    
    lastMatch = null;
    return false;
  }
  
  actions.add('match_pair', matchPair, {hidden: true});
  actions.add('match_pair_inward', function(editor){
    return matchPair(editor, 'in');
  }, {label: 'HTML/Match Pair Tag (inward)'});

  actions.add('match_pair_outward', function(editor){
    return matchPair(editor, 'out');
  }, {label: 'HTML/Match Pair Tag (outward)'});
  
  /**
   * Moves caret to matching opening or closing tag
   * @param {IEmmetEditor} editor
   */
  actions.add('matching_pair', function(editor) {
    var content = String(editor.getContent());
    var caretPos = editor.getCaretPos();
    
    if (content.charAt(caretPos) == '<') 
      // looks like caret is outside of tag pair  
      caretPos++;
      
    var tag = matcher.tag(content, caretPos);
    if (tag && tag.close) { // exclude unary tags
      if (tag.open.range.inside(caretPos)) {
        editor.setCaretPos(tag.close.range.start);
      } else {
        editor.setCaretPos(tag.open.range.start);
      }
      
      return true;
    }
    
    return false;
  }, {label: 'HTML/Go To Matching Tag Pair'});
});/**
 * Gracefully removes tag under cursor
 * 
 * @param {Function} require
 * @param {Underscore} _ 
 */
emmet.exec(function(require, _) {
  require('actions').add('remove_tag', function(editor) {
    var utils = require('utils');
    var info = require('editorUtils').outputInfo(editor);
    
    // search for tag
    var tag = require('htmlMatcher').tag(info.content, editor.getCaretPos());
    if (tag) {
      if (!tag.close) {
        // simply remove unary tag
        editor.replaceContent(utils.getCaretPlaceholder(), tag.range.start, tag.range.end);
      } else {
        // remove tag and its newlines
        /** @type Range */
        var tagContentRange = utils.narrowToNonSpace(info.content, tag.innerRange);
        /** @type Range */
        var startLineBounds = utils.findNewlineBounds(info.content, tagContentRange.start);
        var startLinePad = utils.getLinePadding(startLineBounds.substring(info.content));
        var tagContent = tagContentRange.substring(info.content);
        
        tagContent = utils.unindentString(tagContent, startLinePad);
        editor.replaceContent(utils.getCaretPlaceholder() + utils.escapeText(tagContent), tag.outerRange.start, tag.outerRange.end);
      }
      
      return true;
    }
    
    return false;
  }, {label: 'HTML/Remove Tag'});
});
/**
 * Splits or joins tag, e.g. transforms it into a short notation and vice versa:<br>
 * &lt;div&gt;&lt;/div&gt; → &lt;div /&gt; : join<br>
 * &lt;div /&gt; → &lt;div&gt;&lt;/div&gt; : split
 * @param {Function} require
 * @param {Underscore} _
 * @memberOf __splitJoinTagAction
 * @constructor
 */
emmet.exec(function(require, _) {
  /**
   * @param {IEmmetEditor} editor
   * @param {Object} profile
   * @param {Object} tag
   */
  function joinTag(editor, profile, tag) {
    /** @type emmet.utils */
    var utils = require('utils');
    
    // empty closing slash is a nonsense for this action
    var slash = profile.selfClosing() || ' /';
    var content = tag.open.range.substring(tag.source).replace(/\s*>$/, slash + '>');
    
    var caretPos = editor.getCaretPos();
    
    // update caret position
    if (content.length + tag.outerRange.start < caretPos) {
      caretPos = content.length + tag.outerRange.start;
    }
    
    content = utils.escapeText(content);
    editor.replaceContent(content, tag.outerRange.start, tag.outerRange.end);
    editor.setCaretPos(caretPos);
    return true;
  }
  
  function splitTag(editor, profile, tag) {
    /** @type emmet.utils */
    var utils = require('utils');
    
    var nl = utils.getNewline();
    var pad = require('resources').getVariable('indentation');
    var caretPos = editor.getCaretPos();
    
    // define tag content depending on profile
    var tagContent = (profile.tag_nl === true) ? nl + pad + nl : '';
    var content = tag.outerContent().replace(/\s*\/>$/, '>');
    caretPos = tag.outerRange.start + content.length;
    content += tagContent + '</' + tag.open.name + '>';
    
    content = utils.escapeText(content);
    editor.replaceContent(content, tag.outerRange.start, tag.outerRange.end);
    editor.setCaretPos(caretPos);
    return true;
  }
  
  require('actions').add('split_join_tag', function(editor, profileName) {
    var matcher = require('htmlMatcher');
    
    var info = require('editorUtils').outputInfo(editor, null, profileName);
    var profile = require('profile').get(info.profile);
    
    // find tag at current position
    var tag = matcher.tag(info.content, editor.getCaretPos());
    if (tag) {
      return tag.close 
        ? joinTag(editor, profile, tag) 
        : splitTag(editor, profile, tag);
    }
    
    return false;
  }, {label: 'HTML/Split\\Join Tag Declaration'});
});/**
 * Reflect CSS value: takes rule's value under caret and pastes it for the same 
 * rules with vendor prefixes
 * @constructor
 * @memberOf __reflectCSSActionDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('reflectCSSValue', function(require, _) {
  /**
   * @type HandlerList List of registered handlers
   */
  var handlers = require('handlerList').create();
  
  require('actions').add('reflect_css_value', function(editor) {
    if (editor.getSyntax() != 'css') return false;
    
    return require('actionUtils').compoundUpdate(editor, doCSSReflection(editor));
  }, {label: 'CSS/Reflect Value'});
  
  function doCSSReflection(editor) {
    /** @type emmet.cssEditTree */
    var cssEditTree = require('cssEditTree');
    var outputInfo = require('editorUtils').outputInfo(editor);
    var caretPos = editor.getCaretPos();
    
    var cssRule = cssEditTree.parseFromPosition(outputInfo.content, caretPos);
    if (!cssRule) return;
    
    var property = cssRule.itemFromPosition(caretPos, true);
    // no property under cursor, nothing to reflect
    if (!property) return;
    
    var oldRule = cssRule.source;
    var offset = cssRule.options.offset;
    var caretDelta = caretPos - offset - property.range().start;
    
    handlers.exec(false, [property]);
    
    if (oldRule !== cssRule.source) {
      return {
        data:  cssRule.source,
        start: offset,
        end:   offset + oldRule.length,
        caret: offset + property.range().start + caretDelta
      };
    }
  }
  
  /**
   * Returns regexp that should match reflected CSS property names
   * @param {String} name Current CSS property name
   * @return {RegExp}
   */
  function getReflectedCSSName(name) {
    name = require('cssEditTree').baseName(name);
    var vendorPrefix = '^(?:\\-\\w+\\-)?', m;
    
    if (name == 'opacity' || name == 'filter') {
      return new RegExp(vendorPrefix + '(?:opacity|filter)$');
    } else if (m = name.match(/^border-radius-(top|bottom)(left|right)/)) {
      // Mozilla-style border radius
      return new RegExp(vendorPrefix + '(?:' + name + '|border-' + m[1] + '-' + m[2] + '-radius)$');
    } else if (m = name.match(/^border-(top|bottom)-(left|right)-radius/)) { 
      return new RegExp(vendorPrefix + '(?:' + name + '|border-radius-' + m[1] + m[2] + ')$');
    }
    
    return new RegExp(vendorPrefix + name + '$');
  }
  
  /**
   * Reflects value from <code>donor</code> into <code>receiver</code>
   * @param {CSSProperty} donor Donor CSS property from which value should
   * be reflected
   * @param {CSSProperty} receiver Property that should receive reflected 
   * value from donor
   */
  function reflectValue(donor, receiver) {
    var value = getReflectedValue(donor.name(), donor.value(), 
        receiver.name(), receiver.value());
    
    receiver.value(value);
  }
  
  /**
   * Returns value that should be reflected for <code>refName</code> CSS property
   * from <code>curName</code> property. This function is used for special cases,
   * when the same result must be achieved with different properties for different
   * browsers. For example: opаcity:0.5; → filter:alpha(opacity=50);<br><br>
   * 
   * This function does value conversion between different CSS properties
   * 
   * @param {String} curName Current CSS property name
   * @param {String} curValue Current CSS property value
   * @param {String} refName Receiver CSS property's name 
   * @param {String} refValue Receiver CSS property's value
   * @return {String} New value for receiver property
   */
  function getReflectedValue(curName, curValue, refName, refValue) {
    var cssEditTree = require('cssEditTree');
    var utils = require('utils');
    curName = cssEditTree.baseName(curName);
    refName = cssEditTree.baseName(refName);
    
    if (curName == 'opacity' && refName == 'filter') {
      return refValue.replace(/opacity=[^)]*/i, 'opacity=' + Math.floor(parseFloat(curValue) * 100));
    } else if (curName == 'filter' && refName == 'opacity') {
      var m = curValue.match(/opacity=([^)]*)/i);
      return m ? utils.prettifyNumber(parseInt(m[1]) / 100) : refValue;
    }
    
    return curValue;
  }
  
  // XXX add default handler
  handlers.add(function(property) {
    var reName = getReflectedCSSName(property.name());
    _.each(property.parent.list(), function(p) {
      if (reName.test(p.name())) {
        reflectValue(property, p);
      }
    });
  }, {order: -1});
  
  return {
    /**
     * Adds custom reflect handler. The passed function will receive matched
     * CSS property (as <code>CSSEditElement</code> object) and should
     * return <code>true</code> if it was performed successfully (handled 
     * reflection), <code>false</code> otherwise.
     * @param {Function} fn
     * @param {Object} options
     */
    addHandler: function(fn, options) {
      handlers.add(fn, options);
    },
    
    /**
     * Removes registered handler
     * @returns
     */
    removeHandler: function(fn) {
      handlers.remove(fn, options);
    }
  };
});/**
 * Evaluates simple math expression under caret
 * @param {Function} require
 * @param {Underscore} _ 
 */
emmet.exec(function(require, _) {
  require('actions').add('evaluate_math_expression', function(editor) {
    var actionUtils = require('actionUtils');
    var utils = require('utils');
    
    var content = String(editor.getContent());
    var chars = '.+-*/\\';
    
    /** @type Range */
    var sel = require('range').create(editor.getSelectionRange());
    if (!sel.length()) {
      sel = actionUtils.findExpressionBounds(editor, function(ch) {
        return utils.isNumeric(ch) || chars.indexOf(ch) != -1;
      });
    }
    
    if (sel && sel.length()) {
      var expr = sel.substring(content);
      
      // replace integral division: 11\2 => Math.round(11/2) 
      expr = expr.replace(/([\d\.\-]+)\\([\d\.\-]+)/g, 'Math.round($1/$2)');
      
      try {
        var result = utils.prettifyNumber(new Function('return ' + expr)());
        editor.replaceContent(result, sel.start, sel.end);
        editor.setCaretPos(sel.start + result.length);
        return true;
      } catch (e) {}
    }
    
    return false;
  }, {label: 'Numbers/Evaluate Math Expression'});
});
/**
 * Increment/decrement number under cursor
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  /**
   * Extract number from current caret position of the <code>editor</code> and
   * increment it by <code>step</code>
   * @param {IEmmetEditor} editor
   * @param {Number} step Increment step (may be negative)
   */
  function incrementNumber(editor, step) {
    var utils = require('utils');
    var actionUtils = require('actionUtils');
    
    var hasSign = false;
    var hasDecimal = false;
      
    var r = actionUtils.findExpressionBounds(editor, function(ch, pos, content) {
      if (utils.isNumeric(ch))
        return true;
      if (ch == '.') {
        // make sure that next character is numeric too
        if (!utils.isNumeric(content.charAt(pos + 1)))
          return false;
        
        return hasDecimal ? false : hasDecimal = true;
      }
      if (ch == '-')
        return hasSign ? false : hasSign = true;
        
      return false;
    });
      
    if (r && r.length()) {
      var strNum = r.substring(String(editor.getContent()));
      var num = parseFloat(strNum);
      if (!_.isNaN(num)) {
        num = utils.prettifyNumber(num + step);
        
        // do we have zero-padded number?
        if (/^(\-?)0+[1-9]/.test(strNum)) {
          var minus = '';
          if (RegExp.$1) {
            minus = '-';
            num = num.substring(1);
          }
            
          var parts = num.split('.');
          parts[0] = utils.zeroPadString(parts[0], intLength(strNum));
          num = minus + parts.join('.');
        }
        
        editor.replaceContent(num, r.start, r.end);
        editor.createSelection(r.start, r.start + num.length);
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Returns length of integer part of number
   * @param {String} num
   */
  function intLength(num) {
    num = num.replace(/^\-/, '');
    if (~num.indexOf('.')) {
      return num.split('.')[0].length;
    }
    
    return num.length;
  }
  
  var actions = require('actions');
  _.each([1, -1, 10, -10, 0.1, -0.1], function(num) {
    var prefix = num > 0 ? 'increment' : 'decrement';
    
    actions.add(prefix + '_number_by_' + String(Math.abs(num)).replace('.', '').substring(0, 2), function(editor) {
      return incrementNumber(editor, num);
    }, {label: 'Numbers/' + prefix.charAt(0).toUpperCase() + prefix.substring(1) + ' number by ' + Math.abs(num)});
  });
});/**
 * Actions to insert line breaks. Some simple editors (like browser's 
 * &lt;textarea&gt;, for example) do not provide such simple things
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  var actions = require('actions');
  /** @type emmet.preferences */
  var prefs = require('preferences');
  
  // setup default preferences
  prefs.define('css.closeBraceIndentation', '\n',
      'Indentation before closing brace of CSS rule. Some users prefere ' 
      + 'indented closing brace of CSS rule for better readability. '
      + 'This preference’s value will be automatically inserted before '
      + 'closing brace when user adds newline in newly created CSS rule '
      + '(e.g. when “Insert formatted linebreak” action will be performed ' 
      + 'in CSS file). If you’re such user, you may want to write put a value ' 
      + 'like <code>\\n\\t</code> in this preference.');
  
  /**
   * Inserts newline character with proper indentation in specific positions only.
   * @param {IEmmetEditor} editor
   * @return {Boolean} Returns <code>true</code> if line break was inserted 
   */
  actions.add('insert_formatted_line_break_only', function(editor) {
    var utils = require('utils');
    /** @type emmet.resources */
    var res = require('resources');
    
    var info = require('editorUtils').outputInfo(editor);
    var caretPos = editor.getCaretPos();
    var nl = utils.getNewline();
    
    if (_.include(['html', 'xml', 'xsl'], info.syntax)) {
      var pad = res.getVariable('indentation');
      // let's see if we're breaking newly created tag
      var tag = require('htmlMatcher').tag(info.content, caretPos);
      if (tag && !tag.innerRange.length()) {
        editor.replaceContent(nl + pad + utils.getCaretPlaceholder() + nl, caretPos);
        return true;
      }
    } else if (info.syntax == 'css') {
      /** @type String */
      var content = info.content;
      if (caretPos && content.charAt(caretPos - 1) == '{') {
        var append = prefs.get('css.closeBraceIndentation');
        var pad = res.getVariable('indentation');
        
        var hasCloseBrace = content.charAt(caretPos) == '}';
        if (!hasCloseBrace) {
          // do we really need special formatting here?
          // check if this is really a newly created rule,
          // look ahead for a closing brace
          for (var i = caretPos, il = content.length, ch; i < il; i++) {
            ch = content.charAt(i);
            if (ch == '{') {
              // ok, this is a new rule without closing brace
              break;
            }
            
            if (ch == '}') {
              // not a new rule, just add indentation
              append = '';
              hasCloseBrace = true;
              break;
            }
          }
        }
        
        if (!hasCloseBrace) {
          append += '}';
        }
        
        // defining rule set
        var insValue = nl + pad + utils.getCaretPlaceholder() + append;
        editor.replaceContent(insValue, caretPos);
        return true;
      }
    }
      
    return false;
  }, {hidden: true});
  
  /**
   * Inserts newline character with proper indentation. This action is used in
   * editors that doesn't have indentation control (like textarea element) to 
   * provide proper indentation
   * @param {IEmmetEditor} editor Editor instance
   */
  actions.add('insert_formatted_line_break', function(editor) {
    if (!actions.run('insert_formatted_line_break_only', editor)) {
      var utils = require('utils');
      
      var curPadding = require('editorUtils').getCurrentLinePadding(editor);
      var content = String(editor.getContent());
      var caretPos = editor.getCaretPos();
      var len = content.length;
      var nl = utils.getNewline();
        
      // check out next line padding
      var lineRange = editor.getCurrentLineRange();
      var nextPadding = '';
        
      for (var i = lineRange.end + 1, ch; i < len; i++) {
        ch = content.charAt(i);
        if (ch == ' ' || ch == '\t')
          nextPadding += ch;
        else
          break;
      }
      
      if (nextPadding.length > curPadding.length)
        editor.replaceContent(nl + nextPadding, caretPos, caretPos, true);
      else
        editor.replaceContent(nl, caretPos);
    }
    
    return true;
  }, {hidden: true});
});/**
 * Merges selected lines or lines between XHTML tag pairs
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  require('actions').add('merge_lines', function(editor) {
    var matcher = require('htmlMatcher');
    var utils = require('utils');
    var editorUtils = require('editorUtils');
    var info = editorUtils.outputInfo(editor);
    
    /** @type Range */
    var selection = require('range').create(editor.getSelectionRange());
    if (!selection.length()) {
      // find matching tag
      var pair = matcher.find(info.content, editor.getCaretPos());
      if (pair) {
        selection = pair.outerRange;
      }
    }
    
    if (selection.length()) {
      // got range, merge lines
      var text =  selection.substring(info.content);
      var lines = utils.splitByLines(text);
      
      for (var i = 1; i < lines.length; i++) {
        lines[i] = lines[i].replace(/^\s+/, '');
      }
      
      text = lines.join('').replace(/\s{2,}/, ' ');
      var textLen = text.length;
      text = utils.escapeText(text);
      editor.replaceContent(text, selection.start, selection.end);
      editor.createSelection(selection.start, selection.start + textLen);
      
      return true;
    }
    
    return false;
  });
});/**
 * Encodes/decodes image under cursor to/from base64
 * @param {IEmmetEditor} editor
 * @since 0.65
 * 
 * @memberOf __base64ActionDefine
 * @constructor
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  require('actions').add('encode_decode_data_url', function(editor) {
    var data = String(editor.getSelection());
    var caretPos = editor.getCaretPos();
      
    if (!data) {
      // no selection, try to find image bounds from current caret position
      var text = String(editor.getContent()),  m;
      while (caretPos-- >= 0) {
        if (startsWith('src=', text, caretPos)) { // found <img src="">
          if (m = text.substr(caretPos).match(/^(src=(["'])?)([^'"<>\s]+)\1?/)) {
            data = m[3];
            caretPos += m[1].length;
          }
          break;
        } else if (startsWith('url(', text, caretPos)) { // found CSS url() pattern
          if (m = text.substr(caretPos).match(/^(url\((['"])?)([^'"\)\s]+)\1?/)) {
            data = m[3];
            caretPos += m[1].length;
          }
          break;
        }
      }
    }
    
    if (data) {
      if (startsWith('data:', data))
        return decodeFromBase64(editor, data, caretPos);
      else
        return encodeToBase64(editor, data, caretPos);
    }
    
    return false;
  }, {label: 'Encode\\Decode data:URL image'});
  
  /**
   * Test if <code>text</code> starts with <code>token</code> at <code>pos</code>
   * position. If <code>pos</code> is omitted, search from beginning of text 
   * @param {String} token Token to test
   * @param {String} text Where to search
   * @param {Number} pos Position where to start search
   * @return {Boolean}
   * @since 0.65
   */
  function startsWith(token, text, pos) {
    pos = pos || 0;
    return text.charAt(pos) == token.charAt(0) && text.substr(pos, token.length) == token;
  }
  
  /**
   * Encodes image to base64
   * 
   * @param {IEmmetEditor} editor
   * @param {String} imgPath Path to image
   * @param {Number} pos Caret position where image is located in the editor
   * @return {Boolean}
   */
  function encodeToBase64(editor, imgPath, pos) {
    var file = require('file');
    var actionUtils = require('actionUtils');
    
    var editorFile = editor.getFilePath();
    var defaultMimeType = 'application/octet-stream';
      
    if (editorFile === null) {
      throw "You should save your file before using this action";
    }
    
    // locate real image path
    var realImgPath = file.locateFile(editorFile, imgPath);
    if (realImgPath === null) {
      throw "Can't find " + imgPath + ' file';
    }
    
    file.read(realImgPath, function(err, content) {
      if (err) {
        throw 'Unable to read ' + realImgPath + ': ' + err;
      }
      
      var b64 = require('base64').encode(String(content));
      if (!b64) {
        throw "Can't encode file content to base64";
      }
      
      b64 = 'data:' + (actionUtils.mimeTypes[String(file.getExt(realImgPath))] || defaultMimeType) +
        ';base64,' + b64;
        
      editor.replaceContent('$0' + b64, pos, pos + imgPath.length);
    });
    
    
    return true;
  }

  /**
   * Decodes base64 string back to file.
   * @param {IEmmetEditor} editor
   * @param {String} data Base64-encoded file content
   * @param {Number} pos Caret position where image is located in the editor
   */
  function decodeFromBase64(editor, data, pos) {
    // ask user to enter path to file
    var filePath = String(editor.prompt('Enter path to file (absolute or relative)'));
    if (!filePath)
      return false;
      
    var file = require('file');
    var absPath = file.createPath(editor.getFilePath(), filePath);
    if (!absPath) {
      throw "Can't save file";
    }
    
    file.save(absPath, require('base64').decode( data.replace(/^data\:.+?;.+?,/, '') ));
    editor.replaceContent('$0' + filePath, pos, pos + data.length);
    return true;
  }
});
/**
 * Automatically updates image size attributes in HTML's &lt;img&gt; element or
 * CSS rule
 * @param {Function} require
 * @param {Underscore} _
 * @constructor
 * @memberOf __updateImageSizeAction
 */
emmet.exec(function(require, _) {
  /**
   * Updates image size of &lt;img src=""&gt; tag
   * @param {IEmmetEditor} editor
   */
  function updateImageSizeHTML(editor) {
    var offset = editor.getCaretPos();
    
    // find tag from current caret position
    var info = require('editorUtils').outputInfo(editor);
    var xmlElem = require('xmlEditTree').parseFromPosition(info.content, offset, true);
    if (xmlElem && (xmlElem.name() || '').toLowerCase() == 'img') {
      getImageSizeForSource(editor, xmlElem.value('src'), function(size) {
        if (size) {
          var compoundData = xmlElem.range(true);
          xmlElem.value('width', size.width);
          xmlElem.value('height', size.height, xmlElem.indexOf('width') + 1);
          
          require('actionUtils').compoundUpdate(editor, _.extend(compoundData, {
            data: xmlElem.toString(),
            caret: offset
          }));
        }
      });
    }
  }
  
  /**
   * Updates image size of CSS property
   * @param {IEmmetEditor} editor
   */
  function updateImageSizeCSS(editor) {
    var offset = editor.getCaretPos();
    
    // find tag from current caret position
    var info = require('editorUtils').outputInfo(editor);
    var cssRule = require('cssEditTree').parseFromPosition(info.content, offset, true);
    if (cssRule) {
      // check if there is property with image under caret
      var prop = cssRule.itemFromPosition(offset, true), m;
      if (prop && (m = /url\((["']?)(.+?)\1\)/i.exec(prop.value() || ''))) {
        getImageSizeForSource(editor, m[2], function(size) {
          if (size) {
            var compoundData = cssRule.range(true);
            cssRule.value('width', size.width + 'px');
            cssRule.value('height', size.height + 'px', cssRule.indexOf('width') + 1);
            
            require('actionUtils').compoundUpdate(editor, _.extend(compoundData, {
              data: cssRule.toString(),
              caret: offset
            }));
          }
        });
      }
    }
  }
  
  /**
   * Returns image dimensions for source
   * @param {IEmmetEditor} editor
   * @param {String} src Image source (path or data:url)
   */
  function getImageSizeForSource(editor, src, callback) {
    var fileContent;
    var au = require('actionUtils');
    if (src) {
      // check if it is data:url
      if (/^data:/.test(src)) {
        fileContent = require('base64').decode( src.replace(/^data\:.+?;.+?,/, '') );
        return callback(au.getImageSize(fileContent));
      }
      
      var file = require('file');
      var absPath = file.locateFile(editor.getFilePath(), src);
      if (absPath === null) {
        throw "Can't find " + src + ' file';
      }
      
      file.read(absPath, function(err, content) {
        if (err) {
          throw 'Unable to read ' + absPath + ': ' + err;
        }
        
        content = String(content);
        callback(au.getImageSize(content));
      });
    }
  }
  
  require('actions').add('update_image_size', function(editor) {
    // this action will definitely won’t work in SASS dialect,
    // but may work in SCSS or LESS
    if (_.include(['css', 'less', 'scss'], String(editor.getSyntax()))) {
      updateImageSizeCSS(editor);
    } else {
      updateImageSizeHTML(editor);
    }
    
    return true;
  });
});/**
 * Resolver for fast CSS typing. Handles abbreviations with the following 
 * notation:<br>
 * 
 * <code>(-vendor prefix)?property(value)*(!)?</code>
 * 
 * <br><br>
 * <b>Abbreviation handling</b><br>
 * 
 * By default, Emmet searches for matching snippet definition for provided abbreviation.
 * If snippet wasn't found, Emmet automatically generates element with 
 * abbreviation's name. For example, <code>foo</code> abbreviation will generate
 * <code>&lt;foo&gt;&lt;/foo&gt;</code> output.
 * <br><br>
 * This module will capture all expanded properties and upgrade them with values, 
 * vendor prefixes and !important declarations. All unmatched abbreviations will 
 * be automatically transformed into <code>property-name: ${1}</code> snippets. 
 * 
 * <b>Vendor prefixes<b><br>
 * 
 * If CSS-property is preceded with dash, resolver should output property with
 * all <i>known</i> vendor prefixes. For example, if <code>brad</code> 
 * abbreviation generates <code>border-radius: ${value};</code> snippet,
 * the <code>-brad</code> abbreviation should generate:
 * <pre><code>
 * -webkit-border-radius: ${value};
 * -moz-border-radius: ${value};
 * border-radius: ${value};
 * </code></pre>
 * Note that <i>o</i> and <i>ms</i> prefixes are omitted since Opera and IE 
 * supports unprefixed property.<br><br>
 * 
 * Users can also provide an explicit list of one-character prefixes for any
 * CSS property. For example, <code>-wm-float</code> will produce
 * 
 * <pre><code>
 * -webkit-float: ${1};
 * -moz-float: ${1};
 * float: ${1};
 * </code></pre>
 * 
 * Although this example looks pointless, users can use this feature to write
 * cutting-edge properties implemented by browser vendors recently.  
 * 
 * @constructor
 * @memberOf __cssResolverDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('cssResolver', function(require, _) {
  /** Back-reference to module */
  var module = null;
  
  var prefixObj = {
    /** Real vendor prefix name */
    prefix: 'emmet',
    
    /** 
     * Indicates this prefix is obsolete and should't be used when user 
     * wants to generate all-prefixed properties
     */
    obsolete: false,
    
    /**
     * Returns prefixed CSS property name
     * @param {String} name Unprefixed CSS property
     */
    transformName: function(name) {
      return '-' + this.prefix + '-' + name;
    },
    
    /**
     * List of unprefixed CSS properties that supported by 
     * current prefix. This list is used to generate all-prefixed property
     * @returns {Array} 
     */
    properties: function() {
      return getProperties('css.' + this.prefix + 'Properties') || [];
    },
    
    /**
     * Check if given property is supported by current prefix
     * @param name
     */
    supports: function(name) {
      return _.include(this.properties(), name);
    }
  };
  
  
  /** 
   * List of registered one-character prefixes. Key is a one-character prefix, 
   * value is an <code>prefixObj</code> object
   */
  var vendorPrefixes = {};
  
  var defaultValue = '${1};';
  
  // XXX module preferences
  var prefs = require('preferences');
  prefs.define('css.valueSeparator', ': ',
      'Defines a symbol that should be placed between CSS property and ' 
      + 'value when expanding CSS abbreviations.');
  prefs.define('css.propertyEnd', ';',
      'Defines a symbol that should be placed at the end of CSS property  ' 
      + 'when expanding CSS abbreviations.');
  
  prefs.define('stylus.valueSeparator', ' ',
      'Defines a symbol that should be placed between CSS property and ' 
      + 'value when expanding CSS abbreviations in Stylus dialect.');
  prefs.define('stylus.propertyEnd', '',
      'Defines a symbol that should be placed at the end of CSS property  ' 
      + 'when expanding CSS abbreviations in Stylus dialect.');
  
  prefs.define('sass.propertyEnd', '',
      'Defines a symbol that should be placed at the end of CSS property  ' 
      + 'when expanding CSS abbreviations in SASS dialect.');
  
  prefs.define('css.autoInsertVendorPrefixes', true,
      'Automatically generate vendor-prefixed copies of expanded CSS ' 
      + 'property. By default, Emmet will generate vendor-prefixed '
      + 'properties only when you put dash before abbreviation ' 
      + '(e.g. <code>-bxsh</code>). With this option enabled, you don’t ' 
      + 'need dashes before abbreviations: Emmet will produce ' 
      + 'vendor-prefixed properties for you.');
  
  var descTemplate = _.template('A comma-separated list of CSS properties that may have ' 
    + '<code><%= vendor %></code> vendor prefix. This list is used to generate '
    + 'a list of prefixed properties when expanding <code>-property</code> '
    + 'abbreviations. Empty list means that all possible CSS values may ' 
    + 'have <code><%= vendor %></code> prefix.');
  
  var descAddonTemplate = _.template('A comma-separated list of <em>additional</em> CSS properties ' 
      + 'for <code>css.<%= vendor %>Preperties</code> preference. ' 
      + 'You should use this list if you want to add or remove a few CSS ' 
      + 'properties to original set. To add a new property, simply write its name, '
      + 'to remove it, precede property with hyphen.<br>'
      + 'For example, to add <em>foo</em> property and remove <em>border-radius</em> one, '
      + 'the preference value will look like this: <code>foo, -border-radius</code>.');
  
  // properties list is created from cssFeatures.html file
  var props = {
    'webkit': 'animation, animation-delay, animation-direction, animation-duration, animation-fill-mode, animation-iteration-count, animation-name, animation-play-state, animation-timing-function, appearance, backface-visibility, background-clip, background-composite, background-origin, background-size, border-fit, border-horizontal-spacing, border-image, border-vertical-spacing, box-align, box-direction, box-flex, box-flex-group, box-lines, box-ordinal-group, box-orient, box-pack, box-reflect, box-shadow, color-correction, column-break-after, column-break-before, column-break-inside, column-count, column-gap, column-rule-color, column-rule-style, column-rule-width, column-span, column-width, dashboard-region, font-smoothing, highlight, hyphenate-character, hyphenate-limit-after, hyphenate-limit-before, hyphens, line-box-contain, line-break, line-clamp, locale, margin-before-collapse, margin-after-collapse, marquee-direction, marquee-increment, marquee-repetition, marquee-style, mask-attachment, mask-box-image, mask-box-image-outset, mask-box-image-repeat, mask-box-image-slice, mask-box-image-source, mask-box-image-width, mask-clip, mask-composite, mask-image, mask-origin, mask-position, mask-repeat, mask-size, nbsp-mode, perspective, perspective-origin, rtl-ordering, text-combine, text-decorations-in-effect, text-emphasis-color, text-emphasis-position, text-emphasis-style, text-fill-color, text-orientation, text-security, text-stroke-color, text-stroke-width, transform, transition, transform-origin, transform-style, transition-delay, transition-duration, transition-property, transition-timing-function, user-drag, user-modify, user-select, writing-mode, svg-shadow, box-sizing, border-radius',
    'moz': 'animation-delay, animation-direction, animation-duration, animation-fill-mode, animation-iteration-count, animation-name, animation-play-state, animation-timing-function, appearance, backface-visibility, background-inline-policy, binding, border-bottom-colors, border-image, border-left-colors, border-right-colors, border-top-colors, box-align, box-direction, box-flex, box-ordinal-group, box-orient, box-pack, box-shadow, box-sizing, column-count, column-gap, column-rule-color, column-rule-style, column-rule-width, column-width, float-edge, font-feature-settings, font-language-override, force-broken-image-icon, hyphens, image-region, orient, outline-radius-bottomleft, outline-radius-bottomright, outline-radius-topleft, outline-radius-topright, perspective, perspective-origin, stack-sizing, tab-size, text-blink, text-decoration-color, text-decoration-line, text-decoration-style, text-size-adjust, transform, transform-origin, transform-style, transition, transition-delay, transition-duration, transition-property, transition-timing-function, user-focus, user-input, user-modify, user-select, window-shadow, background-clip, border-radius',
    'ms': 'accelerator, backface-visibility, background-position-x, background-position-y, behavior, block-progression, box-align, box-direction, box-flex, box-line-progression, box-lines, box-ordinal-group, box-orient, box-pack, content-zoom-boundary, content-zoom-boundary-max, content-zoom-boundary-min, content-zoom-chaining, content-zoom-snap, content-zoom-snap-points, content-zoom-snap-type, content-zooming, filter, flow-from, flow-into, font-feature-settings, grid-column, grid-column-align, grid-column-span, grid-columns, grid-layer, grid-row, grid-row-align, grid-row-span, grid-rows, high-contrast-adjust, hyphenate-limit-chars, hyphenate-limit-lines, hyphenate-limit-zone, hyphens, ime-mode, interpolation-mode, layout-flow, layout-grid, layout-grid-char, layout-grid-line, layout-grid-mode, layout-grid-type, line-break, overflow-style, perspective, perspective-origin, perspective-origin-x, perspective-origin-y, scroll-boundary, scroll-boundary-bottom, scroll-boundary-left, scroll-boundary-right, scroll-boundary-top, scroll-chaining, scroll-rails, scroll-snap-points-x, scroll-snap-points-y, scroll-snap-type, scroll-snap-x, scroll-snap-y, scrollbar-arrow-color, scrollbar-base-color, scrollbar-darkshadow-color, scrollbar-face-color, scrollbar-highlight-color, scrollbar-shadow-color, scrollbar-track-color, text-align-last, text-autospace, text-justify, text-kashida-space, text-overflow, text-size-adjust, text-underline-position, touch-action, transform, transform-origin, transform-origin-x, transform-origin-y, transform-origin-z, transform-style, transition, transition-delay, transition-duration, transition-property, transition-timing-function, user-select, word-break, word-wrap, wrap-flow, wrap-margin, wrap-through, writing-mode',
    'o': 'dashboard-region, animation, animation-delay, animation-direction, animation-duration, animation-fill-mode, animation-iteration-count, animation-name, animation-play-state, animation-timing-function, border-image, link, link-source, object-fit, object-position, tab-size, table-baseline, transform, transform-origin, transition, transition-delay, transition-duration, transition-property, transition-timing-function, accesskey, input-format, input-required, marquee-dir, marquee-loop, marquee-speed, marquee-style'
  };
  
  _.each(props, function(v, k) {
    prefs.define('css.' + k + 'Properties', v, descTemplate({vendor: k}));
    prefs.define('css.' + k + 'PropertiesAddon', '', descAddonTemplate({vendor: k}));
  });
  
  prefs.define('css.unitlessProperties', 'z-index, line-height, opacity, font-weight, zoom', 
      'The list of properties whose values ​​must not contain units.');
  
  prefs.define('css.intUnit', 'px', 'Default unit for integer values');
  prefs.define('css.floatUnit', 'em', 'Default unit for float values');
  
  prefs.define('css.keywords', 'auto, inherit', 
      'A comma-separated list of valid keywords that can be used in CSS abbreviations.');
  
  prefs.define('css.keywordAliases', 'a:auto, i:inherit, s:solid, da:dashed, do:dotted, t:transparent', 
      'A comma-separated list of keyword aliases, used in CSS abbreviation. '
      + 'Each alias should be defined as <code>alias:keyword_name</code>.');
  
  prefs.define('css.unitAliases', 'e:em, p:%, x:ex, r:rem', 
      'A comma-separated list of unit aliases, used in CSS abbreviation. '
      + 'Each alias should be defined as <code>alias:unit_value</code>.');
  
  prefs.define('css.color.short', true, 
      'Should color values like <code>#ffffff</code> be shortened to '
      + '<code>#fff</code> after abbreviation with color was expanded.');
  
  prefs.define('css.color.case', 'keep', 
      'Letter case of color values generated by abbreviations with color '
      + '(like <code>c#0</code>). Possible values are <code>upper</code>, '
      + '<code>lower</code> and <code>keep</code>.');
  
  prefs.define('css.fuzzySearch', true, 
      'Enable fuzzy search among CSS snippet names. When enabled, every ' 
      + '<em>unknown</em> snippet will be scored against available snippet '
      + 'names (not values or CSS properties!). The match with best score '
      + 'will be used to resolve snippet value. For example, with this ' 
      + 'preference enabled, the following abbreviations are equal: '
      + '<code>ov:h</code> == <code>ov-h</code> == <code>o-h</code> == '
      + '<code>oh</code>');
  
  prefs.define('css.fuzzySearchMinScore', 0.3, 
      'The minium score (from 0 to 1) that fuzzy-matched abbreviation should ' 
      + 'achive. Lower values may produce many false-positive matches, '
      + 'higher values may reduce possible matches.');
  
  prefs.define('css.alignVendor', false, 
      'If set to <code>true</code>, all generated vendor-prefixed properties ' 
      + 'will be aligned by real property name.');
  
  
  function isNumeric(ch) {
    var code = ch && ch.charCodeAt(0);
    return (ch && ch == '.' || (code > 47 && code < 58));
  }
  
  /**
   * Check if provided snippet contains only one CSS property and value.
   * @param {String} snippet
   * @returns {Boolean}
   */
  function isSingleProperty(snippet) {
    var utils = require('utils');
    snippet = utils.trim(snippet);
    
    // check if it doesn't contain a comment and a newline
    if (~snippet.indexOf('/*') || /[\n\r]/.test(snippet)) {
      return false;
    }
    
    // check if it's a valid snippet definition
    if (!/^[a-z0-9\-]+\s*\:/i.test(snippet)) {
      return false;
    }
    
    snippet = require('tabStops').processText(snippet, {
      replaceCarets: true,
      tabstop: function() {
        return 'value';
      }
    });
    
    return snippet.split(':').length == 2;
  }
  
  /**
   * Normalizes abbreviated value to final CSS one
   * @param {String} value
   * @returns {String}
   */
  function normalizeValue(value) {
    if (value.charAt(0) == '-' && !/^\-[\.\d]/.test(value)) {
      value = value.replace(/^\-+/, '');
    }
    
    if (value.charAt(0) == '#') {
      return normalizeHexColor(value);
    }
    
    return getKeyword(value);
  }
  
  function normalizeHexColor(value) {
    var hex = value.replace(/^#+/, '') || '0';
    if (hex.toLowerCase() == 't') {
      return 'transparent';
    }
    
    var repeat = require('utils').repeatString;
    var color = null;
    switch (hex.length) {
      case 1:
        color = repeat(hex, 6);
        break;
      case 2:
        color = repeat(hex, 3);
        break;
      case 3:
        color = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
        break;
      case 4:
        color = hex + hex.substr(0, 2);
        break;
      case 5:
        color = hex + hex.charAt(0);
        break;
      default:
        color = hex.substr(0, 6);
    }
    
    // color must be shortened?
    if (prefs.get('css.color.short')) {
      var p = color.split('');
      if (p[0] == p[1] && p[2] == p[3] && p[4] == p[5]) {
        color = p[0] + p[2] + p[4];
      }
    }
    
    // should transform case?
    switch (prefs.get('css.color.case')) {
      case 'upper':
        color = color.toUpperCase();
        break;
      case 'lower':
        color = color.toLowerCase();
        break;
    }
    
    return '#' + color;
  }
  
  function getKeyword(name) {
    var aliases = prefs.getDict('css.keywordAliases');
    return name in aliases ? aliases[name] : name;
  }
  
  function getUnit(name) {
    var aliases = prefs.getDict('css.unitAliases');
    return name in aliases ? aliases[name] : name;
  }
  
  function isValidKeyword(keyword) {
    return _.include(prefs.getArray('css.keywords'), getKeyword(keyword));
  }
  
  /**
   * Check if passed CSS property support specified vendor prefix 
   * @param {String} property
   * @param {String} prefix
   */
  function hasPrefix(property, prefix) {
    var info = vendorPrefixes[prefix];
    
    if (!info)
      info = _.find(vendorPrefixes, function(data) {
        return data.prefix == prefix;
      });
    
    return info && info.supports(property);
  }
  
  /**
   * Search for a list of supported prefixes for CSS property. This list
   * is used to generate all-prefixed snippet
   * @param {String} property CSS property name
   * @returns {Array}
   */
  function findPrefixes(property, noAutofill) {
    var result = [];
    _.each(vendorPrefixes, function(obj, prefix) {
      if (hasPrefix(property, prefix)) {
        result.push(prefix);
      }
    });
    
    if (!result.length && !noAutofill) {
      // add all non-obsolete prefixes
      _.each(vendorPrefixes, function(obj, prefix) {
        if (!obj.obsolete)
          result.push(prefix);
      });
    }
    
    return result;
  }
  
  function addPrefix(name, obj) {
    if (_.isString(obj))
      obj = {prefix: obj};
    
    vendorPrefixes[name] = _.extend({}, prefixObj, obj);
  }
  
  function getSyntaxPreference(name, syntax) {
    if (syntax) {
      var val = prefs.get(syntax + '.' + name);
      if (!_.isUndefined(val))
        return val;
    }
    
    return prefs.get('css.' + name);
  }
  
  /**
   * Format CSS property according to current syntax dialect
   * @param {String} property
   * @param {String} syntax
   * @returns {String}
   */
  function formatProperty(property, syntax) {
    var ix = property.indexOf(':');
    property = property.substring(0, ix).replace(/\s+$/, '') 
      + getSyntaxPreference('valueSeparator', syntax)
      + require('utils').trim(property.substring(ix + 1));
    
    return property.replace(/\s*;\s*$/, getSyntaxPreference('propertyEnd', syntax));
  }
  
  /**
   * Transforms snippet value if required. For example, this transformation
   * may add <i>!important</i> declaration to CSS property
   * @param {String} snippet
   * @param {Boolean} isImportant
   * @returns {String}
   */
  function transformSnippet(snippet, isImportant, syntax) {
    if (!_.isString(snippet))
      snippet = snippet.data;
    
    if (!isSingleProperty(snippet))
      return snippet;
    
    if (isImportant) {
      if (~snippet.indexOf(';')) {
        snippet = snippet.split(';').join(' !important;');
      } else {
        snippet += ' !important';
      }
    }
    
    return formatProperty(snippet, syntax);
  }
  
  /**
   * Helper function that parses comma-separated list of elements into array
   * @param {String} list
   * @returns {Array}
   */
  function parseList(list) {
    var result = _.map((list || '').split(','), require('utils').trim);
    return result.length ? result : null;
  }
  
  function getProperties(key) {
    var list = prefs.getArray(key);
    _.each(prefs.getArray(key + 'Addon'), function(prop) {
      if (prop.charAt(0) == '-') {
        list = _.without(list, prop.substr(1));
      } else {
        if (prop.charAt(0) == '+')
          prop = prop.substr(1);
        
        list.push(prop);
      }
    });
    
    return list;
  }
  
  
  // TODO refactor, this looks awkward now
  addPrefix('w', {
    prefix: 'webkit'
  });
  addPrefix('m', {
    prefix: 'moz'
  });
  addPrefix('s', {
    prefix: 'ms'
  });
  addPrefix('o', {
    prefix: 'o'
  });
  
  // I think nobody uses it
//  addPrefix('k', {
//    prefix: 'khtml',
//    obsolete: true
//  });
  
  var cssSyntaxes = ['css', 'less', 'sass', 'scss', 'stylus'];
  
  /**
   * XXX register resolver
   * @param {TreeNode} node
   * @param {String} syntax
   */
  require('resources').addResolver(function(node, syntax) {
    if (_.include(cssSyntaxes, syntax) && node.isElement()) {
      return module.expandToSnippet(node.abbreviation, syntax);
    }
    
    return null;
  });
  
  var ea = require('expandAbbreviation');
  /**
   * For CSS-like syntaxes, we need to handle a special use case. Some editors
   * (like Sublime Text 2) may insert semicolons automatically when user types
   * abbreviation. After expansion, user receives a double semicolon. This
   * handler automatically removes semicolon from generated content in such cases.
   * @param {IEmmetEditor} editor
   * @param {String} syntax
   * @param {String} profile
   */
  ea.addHandler(function(editor, syntax, profile) {
    if (!_.include(cssSyntaxes, syntax)) {
      return false;
    }
    
    var caretPos = editor.getSelectionRange().end;
    var abbr = ea.findAbbreviation(editor);
      
    if (abbr) {
      var content = emmet.expandAbbreviation(abbr, syntax, profile);
      if (content) {
        var replaceFrom = caretPos - abbr.length;
        var replaceTo = caretPos;
        if (editor.getContent().charAt(caretPos) == ';' && content.charAt(content.length - 1) == ';') {
          replaceTo++;
        }
        
        editor.replaceContent(content, replaceFrom, replaceTo);
        return true;
      }
    }
    
    return false;
  });
  
  return module = {
    /**
     * Adds vendor prefix
     * @param {String} name One-character prefix name
     * @param {Object} obj Object describing vendor prefix
     * @memberOf cssResolver
     */
    addPrefix: addPrefix,
    
    /**
     * Check if passed CSS property supports specified vendor prefix
     * @param {String} property
     * @param {String} prefix
     */
    supportsPrefix: hasPrefix,
    
    /**
     * Returns prefixed version of passed CSS property, only if this
     * property supports such prefix
     * @param {String} property
     * @param {String} prefix
     * @returns
     */
    prefixed: function(property, prefix) {
      return hasPrefix(property, prefix) 
        ? '-' + prefix + '-' + property 
        : property;
    },
    
    /**
     * Returns list of all registered vendor prefixes
     * @returns {Array}
     */
    listPrefixes: function() {
      return _.map(vendorPrefixes, function(obj) {
        return obj.prefix;
      });
    },
    
    /**
     * Returns object describing vendor prefix
     * @param {String} name
     * @returns {Object}
     */
    getPrefix: function(name) {
      return vendorPrefixes[name];
    },
    
    /**
     * Removes prefix object
     * @param {String} name
     */
    removePrefix: function(name) {
      if (name in vendorPrefixes)
        delete vendorPrefixes[name];
    },
    
    /**
     * Extract vendor prefixes from abbreviation
     * @param {String} abbr
     * @returns {Object} Object containing array of prefixes and clean 
     * abbreviation name
     */
    extractPrefixes: function(abbr) {
      if (abbr.charAt(0) != '-') {
        return {
          property: abbr,
          prefixes: null
        };
      }
      
      // abbreviation may either contain sequence of one-character prefixes
      // or just dash, meaning that user wants to produce all possible
      // prefixed properties
      var i = 1, il = abbr.length, ch;
      var prefixes = [];
      
      while (i < il) {
        ch = abbr.charAt(i);
        if (ch == '-') {
          // end-sequence character found, stop searching
          i++;
          break;
        }
        
        if (ch in vendorPrefixes) {
          prefixes.push(ch);
        } else {
          // no prefix found, meaning user want to produce all
          // vendor-prefixed properties
          prefixes.length = 0;
          i = 1;
          break;
        }
        
        i++;
      }
      
      // reached end of abbreviation and no property name left
      if (i == il -1) {
        i = 1;
        prefixes.length = 1;
      }
      
      return {
        property: abbr.substring(i),
        prefixes: prefixes.length ? prefixes : 'all'
      };
    },
    
    /**
     * Search for value substring in abbreviation
     * @param {String} abbr
     * @returns {String} Value substring
     */
    findValuesInAbbreviation: function(abbr, syntax) {
      syntax = syntax || 'css';
      
      var i = 0, il = abbr.length, value = '', ch;
      while (i < il) {
        ch = abbr.charAt(i);
        if (isNumeric(ch) || ch == '#' || (ch == '-' && isNumeric(abbr.charAt(i + 1)))) {
          value = abbr.substring(i);
          break;
        }
        
        i++;
      }
      
      // try to find keywords in abbreviation
      var property = abbr.substring(0, abbr.length - value.length);
      var res = require('resources');
      var keywords = [];
      // try to extract some commonly-used properties
      while (~property.indexOf('-') && !res.findSnippet(syntax, property)) {
        var parts = property.split('-');
        var lastPart = parts.pop();
        if (!isValidKeyword(lastPart)) {
          break;
        }
        
        keywords.unshift(lastPart);
        property = parts.join('-');
      }
      
      return keywords.join('-') + value;
    },
    
    parseValues: function(str) {
      /** @type StringStream */
      var stream = require('stringStream').create(str);
      var values = [];
      var ch = null;
      
      while (ch = stream.next()) {
        if (ch == '#') {
          stream.match(/^t|[0-9a-f]+/i, true);
          values.push(stream.current());
        } else if (ch == '-') {
          if (isValidKeyword(_.last(values)) || 
              ( stream.start && isNumeric(str.charAt(stream.start - 1)) )
            ) {
            stream.start = stream.pos;
          }
          
          stream.match(/^\-?[0-9]*(\.[0-9]+)?[a-z%\.]*/, true);
          values.push(stream.current());
        } else {
          stream.match(/^[0-9]*(\.[0-9]*)?[a-z%]*/, true);
          values.push(stream.current());
        }
        
        stream.start = stream.pos;
      }
      
      return _.map(_.compact(values), normalizeValue);
    },
    
    /**
     * Extracts values from abbreviation
     * @param {String} abbr
     * @returns {Object} Object containing array of values and clean 
     * abbreviation name
     */
    extractValues: function(abbr) {
      // search for value start
      var abbrValues = this.findValuesInAbbreviation(abbr);
      if (!abbrValues) {
        return {
          property: abbr,
          values: null
        };
      }
      
      return {
        property: abbr.substring(0, abbr.length - abbrValues.length).replace(/-$/, ''),
        values: this.parseValues(abbrValues)
      };
    },
    
    /**
     * Normalizes value, defined in abbreviation.
     * @param {String} value
     * @param {String} property
     * @returns {String}
     */
    normalizeValue: function(value, property) {
      property = (property || '').toLowerCase();
      var unitlessProps = prefs.getArray('css.unitlessProperties');
      return value.replace(/^(\-?[0-9\.]+)([a-z]*)$/, function(str, val, unit) {
        if (!unit && (val == '0' || _.include(unitlessProps, property)))
          return val;
        
        if (!unit)
          return val.replace(/\.$/, '') + prefs.get(~val.indexOf('.') ? 'css.floatUnit' : 'css.intUnit');
        
        return val + getUnit(unit);
      });
    },
    
    /**
     * Expands abbreviation into a snippet
     * @param {String} abbr Abbreviation name to expand
     * @param {String} value Abbreviation value
     * @param {String} syntax Currect syntax or dialect. Default is 'css'
     * @returns {Object} Array of CSS properties and values or predefined
     * snippet (string or element)
     */
    expand: function(abbr, value, syntax) {
      syntax = syntax || 'css';
      var resources = require('resources');
      var autoInsertPrefixes = prefs.get('css.autoInsertVendorPrefixes');
      
      // check if snippet should be transformed to !important
      var isImportant;
      if (isImportant = /^(.+)\!$/.test(abbr)) {
        abbr = RegExp.$1;
      }
      
      // check if we have abbreviated resource
      var snippet = resources.findSnippet(syntax, abbr);
      if (snippet && !autoInsertPrefixes) {
        return transformSnippet(snippet, isImportant, syntax);
      }
      
      // no abbreviated resource, parse abbreviation
      var prefixData = this.extractPrefixes(abbr);
      var valuesData = this.extractValues(prefixData.property);
      var abbrData = _.extend(prefixData, valuesData);
      
      if (!snippet) {
        snippet = resources.findSnippet(syntax, abbrData.property);
      } else {
        abbrData.values = null;
      }
      
      if (!snippet && prefs.get('css.fuzzySearch')) {
        // let’s try fuzzy search
        snippet = resources.fuzzyFindSnippet(syntax, abbrData.property, parseFloat(prefs.get('css.fuzzySearchMinScore')));
      }
      
      if (!snippet) {
        snippet = abbrData.property + ':' + defaultValue;
      } else if (!_.isString(snippet)) {
        snippet = snippet.data;
      }
      
      if (!isSingleProperty(snippet)) {
        return snippet;
      }
      
      var snippetObj = this.splitSnippet(snippet);
      var result = [];
      if (!value && abbrData.values) {
        value = _.map(abbrData.values, function(val) {
          return this.normalizeValue(val, snippetObj.name);
        }, this).join(' ') + ';';
      }
      
      snippetObj.value = value || snippetObj.value;
      
      var prefixes = abbrData.prefixes == 'all' || (!abbrData.prefixes && autoInsertPrefixes) 
        ? findPrefixes(snippetObj.name, autoInsertPrefixes && abbrData.prefixes != 'all')
        : abbrData.prefixes;
        
        
      var names = [], propName;
      _.each(prefixes, function(p) {
        if (p in vendorPrefixes) {
          propName = vendorPrefixes[p].transformName(snippetObj.name);
          names.push(propName);
          result.push(transformSnippet(propName + ':' + snippetObj.value,
              isImportant, syntax));
        }
      });
      
      // put the original property
      result.push(transformSnippet(snippetObj.name + ':' + snippetObj.value, isImportant, syntax));
      names.push(snippetObj.name);
      
      if (prefs.get('css.alignVendor')) {
        var pads = require('utils').getStringsPads(names);
        result = _.map(result, function(prop, i) {
          return pads[i] + prop;
        });
      }
      
      return result;
    },
    
    /**
     * Same as <code>expand</code> method but transforms output into 
     * Emmet snippet
     * @param {String} abbr
     * @param {String} syntax
     * @returns {String}
     */
    expandToSnippet: function(abbr, syntax) {
      var snippet = this.expand(abbr, null, syntax);
      if (_.isArray(snippet)) {
        return snippet.join('\n');
      }
      
      if (!_.isString(snippet))
        return snippet.data;
      
      return String(snippet);
    },
    
    /**
     * Split snippet into a CSS property-value pair
     * @param {String} snippet
     */
    splitSnippet: function(snippet) {
      var utils = require('utils');
      snippet = utils.trim(snippet);
      if (snippet.indexOf(':') == -1) {
        return {
          name: snippet,
          value: defaultValue
        };
      }
      
      var pair = snippet.split(':');
      
      return {
        name: utils.trim(pair.shift()),
        // replace ${0} tabstop to produce valid vendor-prefixed values
        // where possible
        value: utils.trim(pair.join(':')).replace(/^(\$\{0\}|\$0)(\s*;?)$/, '${1}$2')
      };
    },
    
    getSyntaxPreference: getSyntaxPreference,
    transformSnippet: transformSnippet
  };
});
/**
 * 'Expand Abbreviation' handler that parses gradient definition from under 
 * cursor and updates CSS rule with vendor-prefixed values.
 * 
 * @memberOf __cssGradientHandlerDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('cssGradient', function(require, _) {
  var defaultLinearDirections = ['top', 'to bottom', '0deg'];
  /** Back-reference to current module */
  var module = null;
  
  var cssSyntaxes = ['css', 'less', 'sass', 'scss', 'stylus', 'styl'];
  
  var reDeg = /\d+deg/i;
  var reKeyword = /top|bottom|left|right/i;
  
  // XXX define preferences
  /** @type preferences */
  var prefs = require('preferences');
  prefs.define('css.gradient.prefixes', 'webkit, moz, o',
      'A comma-separated list of vendor-prefixes for which values should ' 
      + 'be generated.');
  
  prefs.define('css.gradient.oldWebkit', true,
      'Generate gradient definition for old Webkit implementations');
  
  prefs.define('css.gradient.omitDefaultDirection', true,
    'Do not output default direction definition in generated gradients.');
  
  prefs.define('css.gradient.defaultProperty', 'background-image',
    'When gradient expanded outside CSS value context, it will produce '
      + 'properties with this name.');
  
  prefs.define('css.gradient.fallback', false,
      'With this option enabled, CSS gradient generator will produce '
      + '<code>background-color</code> property with gradient first color '
      + 'as fallback for old browsers.');
  
  function normalizeSpace(str) {
    return require('utils').trim(str).replace(/\s+/g, ' ');
  }
  
  /**
   * Parses linear gradient definition
   * @param {String}
   */
  function parseLinearGradient(gradient) {
    var direction = defaultLinearDirections[0];
    
    // extract tokens
    /** @type StringStream */
    var stream = require('stringStream').create(require('utils').trim(gradient));
    var colorStops = [], ch;
    while (ch = stream.next()) {
      if (stream.peek() == ',') {
        colorStops.push(stream.current());
        stream.next();
        stream.eatSpace();
        stream.start = stream.pos;
      } else if (ch == '(') { // color definition, like 'rgb(0,0,0)'
        stream.skipTo(')');
      }
    }
    
    // add last token
    colorStops.push(stream.current());
    colorStops = _.compact(_.map(colorStops, normalizeSpace));
    
    if (!colorStops.length)
      return null;
    
    // let's see if the first color stop is actually a direction
    if (reDeg.test(colorStops[0]) || reKeyword.test(colorStops[0])) {
      direction = colorStops.shift();
    }
    
    return {
      type: 'linear',
      direction: direction,
      colorStops: _.map(colorStops, parseColorStop)
    };
  }
  
  /**
   * Parses color stop definition
   * @param {String} colorStop
   * @returns {Object}
   */
  function parseColorStop(colorStop) {
    colorStop = normalizeSpace(colorStop);
    
    // find color declaration
    // first, try complex color declaration, like rgb(0,0,0)
    var color = null;
    colorStop = colorStop.replace(/^(\w+\(.+?\))\s*/, function(str, c) {
      color = c;
      return '';
    });
    
    if (!color) {
      // try simple declaration, like yellow, #fco, #ffffff, etc.
      var parts = colorStop.split(' ');
      color = parts[0];
      colorStop = parts[1] || '';
    }
    
    var result = {
      color: color
    };
    
    if (colorStop) {
      // there's position in color stop definition
      colorStop.replace(/^(\-?[\d\.]+)([a-z%]+)?$/, function(str, pos, unit) {
        result.position = pos;
        if (~pos.indexOf('.')) {
          unit = '';
        } else if (!unit) {
          unit = '%';
        }
        
        if (unit)
          result.unit = unit;
      });
    }
    
    return result;
  }
  
  /**
   * Resolves property name (abbreviation): searches for snippet definition in 
   * 'resources' and returns new name of matched property
   */
  function resolvePropertyName(name, syntax) {
    var res = require('resources');
    var prefs = require('preferences');
    var snippet = res.findSnippet(syntax, name);
    
    if (!snippet && prefs.get('css.fuzzySearch')) {
      snippet = res.fuzzyFindSnippet(syntax, name, 
          parseFloat(prefs.get('css.fuzzySearchMinScore')));
    }
    
    if (snippet) {
      if (!_.isString(snippet)) {
        snippet = snippet.data;
      }
      
      return require('cssResolver').splitSnippet(snippet).name;
    }
  }
  
  /**
   * Fills-out implied positions in color-stops. This function is useful for
   * old Webkit gradient definitions
   */
  function fillImpliedPositions(colorStops) {
    var from = 0;
    
    _.each(colorStops, function(cs, i) {
      // make sure that first and last positions are defined
      if (!i)
        return cs.position = cs.position || 0;
      
      if (i == colorStops.length - 1 && !('position' in cs))
        cs.position = 1;
      
      if ('position' in cs) {
        var start = colorStops[from].position || 0;
        var step = (cs.position - start) / (i - from);
        _.each(colorStops.slice(from, i), function(cs2, j) {
          cs2.position = start + step * j;
        });
        
        from = i;
      }
    });
  }
  
  /**
   * Returns textual version of direction expressed in degrees
   * @param {String} direction
   * @returns {String}
   */
  function textualDirection(direction) {
    var angle = parseFloat(direction);
    
    if(!_.isNaN(angle)) {
      switch(angle % 360) {
        case 0:   return 'left';
        case 90:  return 'bottom';
        case 180: return 'right';
        case 240: return 'top';
      }
    }
    
    return direction;
  }
  
  /**
   * Creates direction definition for old Webkit gradients
   * @param {String} direction
   * @returns {String}
   */
  function oldWebkitDirection(direction) {
    direction = textualDirection(direction);
    
    if(reDeg.test(direction))
      throw "The direction is an angle that can’t be converted.";
    
    var v = function(pos) {
      return ~direction.indexOf(pos) ? '100%' : '0';
    };
    
    return v('right') + ' ' + v('bottom') + ', ' + v('left') + ' ' + v('top');
  }
  
  function getPrefixedNames(name) {
    var prefixes = prefs.getArray('css.gradient.prefixes');
    var names = _.map(prefixes, function(p) {
      return '-' + p + '-' + name;
    });
    names.push(name);
    
    return names;
  }
  
  /**
   * Returns list of CSS properties with gradient
   * @param {Object} gradient
   * @param {String} propertyName Original CSS property name
   * @returns {Array}
   */
  function getPropertiesForGradient(gradient, propertyName) {
    var props = [];
    var css = require('cssResolver');
    
    if (prefs.get('css.gradient.fallback') && ~propertyName.toLowerCase().indexOf('background')) {
      props.push({
        name: 'background-color',
        value: '${1:' + gradient.colorStops[0].color + '}'
      });
    }
    
    _.each(prefs.getArray('css.gradient.prefixes'), function(prefix) {
      var name = css.prefixed(propertyName, prefix);
      if (prefix == 'webkit' && prefs.get('css.gradient.oldWebkit')) {
        try {
          props.push({
            name: name,
            value: module.oldWebkitLinearGradient(gradient)
          });
        } catch(e) {}
      }
      
      props.push({
        name: name,
        value: module.toString(gradient, prefix)
      });
    });
    
    return props.sort(function(a, b) {
      return b.name.length - a.name.length;
    });
  }
  
  /**
   * Pastes gradient definition into CSS rule with correct vendor-prefixes
   * @param {EditElement} property Matched CSS property
   * @param {Object} gradient Parsed gradient
   * @param {Range} valueRange If passed, only this range within property 
   * value will be replaced with gradient. Otherwise, full value will be 
   * replaced
   */
  function pasteGradient(property, gradient, valueRange) {
    var rule = property.parent;
    var utils = require('utils');
    var alignVendor = require('preferences').get('css.alignVendor');
    
    // we may have aligned gradient definitions: find the smallest value
    // separator
    var sep = property.styleSeparator;
    var before = property.styleBefore;
    
    // first, remove all properties within CSS rule with the same name and
    // gradient definition
    _.each(rule.getAll(getPrefixedNames(property.name())), function(item) {
      if (item != property && /gradient/i.test(item.value())) {
        if (item.styleSeparator.length < sep.length) {
          sep = item.styleSeparator;
        }
        if (item.styleBefore.length < before.length) {
          before = item.styleBefore;
        }
        rule.remove(item);
      }
    });
    
    if (alignVendor) {
      // update prefix
      if (before != property.styleBefore) {
        var fullRange = property.fullRange();
        rule._updateSource(before, fullRange.start, fullRange.start + property.styleBefore.length);
        property.styleBefore = before;
      }
      
      // update separator value
      if (sep != property.styleSeparator) {
        rule._updateSource(sep, property.nameRange().end, property.valueRange().start);
        property.styleSeparator = sep;
      }
    }
    
    var value = property.value();
    if (!valueRange)
      valueRange = require('range').create(0, property.value());
    
    var val = function(v) {
      return utils.replaceSubstring(value, v, valueRange);
    };
    
    // put vanilla-clean gradient definition into current rule
    property.value(val(module.toString(gradient)) + '${2}');
    
    // create list of properties to insert
    var propsToInsert = getPropertiesForGradient(gradient, property.name());
    
    // align prefixed values
    if (alignVendor) {
      var values = _.pluck(propsToInsert, 'value');
      var names = _.pluck(propsToInsert, 'name');
      values.push(property.value());
      names.push(property.name());
      
      var valuePads = utils.getStringsPads(_.map(values, function(v) {
        return v.substring(0, v.indexOf('('));
      }));
      
      var namePads = utils.getStringsPads(names);
      property.name(_.last(namePads) + property.name());
      
      _.each(propsToInsert, function(prop, i) {
        prop.name = namePads[i] + prop.name;
        prop.value = valuePads[i] + prop.value;
      });
      
      property.value(_.last(valuePads) + property.value());
    }
    
    // put vendor-prefixed definitions before current rule
    _.each(propsToInsert, function(prop) {
      rule.add(prop.name, prop.value, rule.indexOf(property));
    });
  }
  
  /**
   * Search for gradient definition inside CSS property value
   */
  function findGradient(cssProp) {
    var value = cssProp.value();
    var gradient = null;
    var matchedPart = _.find(cssProp.valueParts(), function(part) {
      return gradient = module.parse(part.substring(value));
    });
    
    if (matchedPart && gradient) {
      return {
        gradient: gradient,
        valueRange: matchedPart
      };
    }
    
    return null;
  }
  
  /**
   * Tries to expand gradient outside CSS value 
   * @param {IEmmetEditor} editor
   * @param {String} syntax
   */
  function expandGradientOutsideValue(editor, syntax) {
    var propertyName = prefs.get('css.gradient.defaultProperty');
    
    if (!propertyName)
      return false;
    
    // assuming that gradient definition is written on new line,
    // do a simplified parsing
    var content = String(editor.getContent());
    /** @type Range */
    var lineRange = require('range').create(editor.getCurrentLineRange());
    
    // get line content and adjust range with padding
    var line = lineRange.substring(content)
      .replace(/^\s+/, function(pad) {
        lineRange.start += pad.length;
        return '';
      })
      .replace(/\s+$/, function(pad) {
        lineRange.end -= pad.length;
        return '';
      });
    
    var css = require('cssResolver');
    var gradient = module.parse(line);
    if (gradient) {
      var props = getPropertiesForGradient(gradient, propertyName);
      props.push({
        name: propertyName,
        value: module.toString(gradient) + '${2}'
      });
      
      var sep = css.getSyntaxPreference('valueSeparator', syntax);
      var end = css.getSyntaxPreference('propertyEnd', syntax);
      
      if (require('preferences').get('css.alignVendor')) {
        var pads = require('utils').getStringsPads(_.map(props, function(prop) {
          return prop.value.substring(0, prop.value.indexOf('('));
        }));
        _.each(props, function(prop, i) {
          prop.value = pads[i] + prop.value;
        });
      }
      
      props = _.map(props, function(item) {
        return item.name + sep + item.value + end;
      });
      
      editor.replaceContent(props.join('\n'), lineRange.start, lineRange.end);
      return true;
    }
    
    return false;
  }
  
  /**
   * Search for gradient definition inside CSS value under cursor
   * @param {String} content
   * @param {Number} pos
   * @returns {Object}
   */
  function findGradientFromPosition(content, pos) {
    var cssProp = null;
    /** @type EditContainer */
    var cssRule = require('cssEditTree').parseFromPosition(content, pos, true);
    
    if (cssRule) {
      cssProp = cssRule.itemFromPosition(pos, true);
      if (!cssProp) {
        // in case user just started writing CSS property
        // and didn't include semicolon–try another approach
        cssProp = _.find(cssRule.list(), function(elem) {
          return elem.range(true).end == pos;
        });
      }
    }
    
    return {
      rule: cssRule,
      property: cssProp
    };
  }
  
  // XXX register expand abbreviation handler
  /**
   * @param {IEmmetEditor} editor
   * @param {String} syntax
   * @param {String} profile
   */
  require('expandAbbreviation').addHandler(function(editor, syntax, profile) {
    var info = require('editorUtils').outputInfo(editor, syntax, profile);
    if (!_.include(cssSyntaxes, info.syntax))
      return false;
    
    // let's see if we are expanding gradient definition
    var caret = editor.getCaretPos();
    var content = info.content;
    var css = findGradientFromPosition(content, caret);
    
    if (css.property) {
      // make sure that caret is inside property value with gradient 
      // definition
      var g = findGradient(css.property);
      if (g) {
        var ruleStart = css.rule.options.offset || 0;
        var ruleEnd = ruleStart + css.rule.toString().length;
        
        // Handle special case:
        // user wrote gradient definition between existing CSS 
        // properties and did not finished it with semicolon.
        // In this case, we have semicolon right after gradient 
        // definition and re-parse rule again
        if (/[\n\r]/.test(css.property.value())) {
          // insert semicolon at the end of gradient definition
          var insertPos = css.property.valueRange(true).start + g.valueRange.end;
          content = require('utils').replaceSubstring(content, ';', insertPos);
          var newCss = findGradientFromPosition(content, caret);
          if (newCss.property) {
            g = findGradient(newCss.property);
            css = newCss;
          }
        }
        
        // make sure current property has terminating semicolon
        css.property.end(';');
        
        // resolve CSS property name
        var resolvedName = resolvePropertyName(css.property.name(), syntax);
        if (resolvedName) {
          css.property.name(resolvedName);
        }
        
        pasteGradient(css.property, g.gradient, g.valueRange);
        editor.replaceContent(css.rule.toString(), ruleStart, ruleEnd, true);
        return true;
      }
    }
    
    return expandGradientOutsideValue(editor, syntax);
  });
  
  // XXX register "Reflect CSS Value" action delegate
  /**
   * @param {EditElement} property
   */
  require('reflectCSSValue').addHandler(function(property) {
    var utils = require('utils');
    
    var g = findGradient(property);
    if (!g)
      return false;
    
    var value = property.value();
    var val = function(v) {
      return utils.replaceSubstring(value, v, g.valueRange);
    };
    
    // reflect value for properties with the same name
    _.each(property.parent.getAll(getPrefixedNames(property.name())), function(prop) {
      if (prop === property)
        return;
      
      // check if property value starts with gradient definition
      var m = prop.value().match(/^\s*(\-([a-z]+)\-)?linear\-gradient/);
      if (m) {
        prop.value(val(module.toString(g.gradient, m[2] || '')));
      } else if (m = prop.value().match(/\s*\-webkit\-gradient/)) {
        // old webkit gradient definition
        prop.value(val(module.oldWebkitLinearGradient(g.gradient)));
      }
    });
    
    return true;
  });
  
  return module = {
    /**
     * Parses gradient definition
     * @param {String} gradient
     * @returns {Object}
     */
    parse: function(gradient) {
      var result = null;
      require('utils').trim(gradient).replace(/^([\w\-]+)\((.+?)\)$/, function(str, type, definition) {
        // remove vendor prefix
        type = type.toLowerCase().replace(/^\-[a-z]+\-/, '');
        if (type == 'linear-gradient' || type == 'lg') {
          result = parseLinearGradient(definition);
          return '';
        }
        
        return str;
      });
      
      return result;
    },
    
    /**
     * Produces linear gradient definition used in early Webkit 
     * implementations
     * @param {Object} gradient Parsed gradient
     * @returns {String}
     */
    oldWebkitLinearGradient: function(gradient) {
      if (_.isString(gradient))
        gradient = this.parse(gradient);
      
      if (!gradient)
        return null;
      
      var colorStops = _.map(gradient.colorStops, _.clone);
      
      // normalize color-stops position
      _.each(colorStops, function(cs) {
        if (!('position' in cs)) // implied position
          return;
        
        if (~cs.position.indexOf('.') || cs.unit == '%') {
          cs.position = parseFloat(cs.position) / (cs.unit == '%' ? 100 : 1);
        } else {
          throw "Can't convert color stop '" + (cs.position + (cs.unit || '')) + "'";
        }
      });
      
      fillImpliedPositions(colorStops);
      
      // transform color-stops into string representation
      colorStops = _.map(colorStops, function(cs, i) {
        if (!cs.position && !i)
          return 'from(' + cs.color + ')';
        
        if (cs.position == 1 && i == colorStops.length - 1)
          return 'to(' + cs.color + ')';
        
        return 'color-stop(' + (cs.position.toFixed(2).replace(/\.?0+$/, '')) + ', ' + cs.color + ')';
      });
      
      return '-webkit-gradient(linear, ' 
        + oldWebkitDirection(gradient.direction)
        + ', '
        + colorStops.join(', ')
        + ')';
    },
    
    /**
     * Returns string representation of parsed gradient
     * @param {Object} gradient Parsed gradient
     * @param {String} prefix Vendor prefix
     * @returns {String}
     */
    toString: function(gradient, prefix) {
      if (gradient.type == 'linear') {
        var fn = (prefix ? '-' + prefix + '-' : '') + 'linear-gradient';
        
        // transform color-stops
        var colorStops = _.map(gradient.colorStops, function(cs) {
          return cs.color + ('position' in cs 
              ? ' ' + cs.position + (cs.unit || '')
              : '');
        });
        
        if (gradient.direction 
            && (!prefs.get('css.gradient.omitDefaultDirection') 
            || !_.include(defaultLinearDirections, gradient.direction))) {
          colorStops.unshift(gradient.direction);
        }
        
        return fn + '(' + colorStops.join(', ') + ')';
      }
    }
  };
});/**
 * Module adds support for generators: a regexp-based abbreviation resolver 
 * that can produce custom output.
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  /** @type HandlerList */
  var generators = require('handlerList').create();
  var resources = require('resources');
  
  _.extend(resources, {
    /**
     * Add generator. A generator function <code>fn</code> will be called 
     * only if current abbreviation matches <code>regexp</code> regular 
     * expression and this function should return <code>null</code> if
     * abbreviation cannot be resolved
     * @param {RegExp} regexp Regular expression for abbreviation element name
     * @param {Function} fn Resolver function
     * @param {Object} options Options list as described in 
     * {@link HandlerList#add()} method
     */
    addGenerator: function(regexp, fn, options) {
      if (_.isString(regexp))
        regexp = new RegExp(regexp);
      
      generators.add(function(node, syntax) {
        var m;
        if ((m = regexp.exec(node.name()))) {
          return fn(m, node, syntax);
        }
        
        return null;
      }, options);
    }
  });
  
  resources.addResolver(function(node, syntax) {
    return generators.exec(null, _.toArray(arguments));
  });
});/**
 * Module for resolving tag names: returns best matched tag name for child
 * element based on passed parent's tag name. Also provides utility function
 * for element type detection (inline, block-level, empty)
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('tagName', function(require, _) {
  var elementTypes = {
    empty: 'area,base,basefont,br,col,frame,hr,img,input,isindex,link,meta,param,embed,keygen,command'.split(','),
    blockLevel: 'address,applet,blockquote,button,center,dd,del,dir,div,dl,dt,fieldset,form,frameset,hr,iframe,ins,isindex,li,link,map,menu,noframes,noscript,object,ol,p,pre,script,table,tbody,td,tfoot,th,thead,tr,ul,h1,h2,h3,h4,h5,h6'.split(','),
    inlineLevel: 'a,abbr,acronym,applet,b,basefont,bdo,big,br,button,cite,code,del,dfn,em,font,i,iframe,img,input,ins,kbd,label,map,object,q,s,samp,select,small,span,strike,strong,sub,sup,textarea,tt,u,var'.split(',')
  };
  
  var elementMap = {
    'p': 'span',
    'ul': 'li',
    'ol': 'li',
    'table': 'tr',
    'tr': 'td',
    'tbody': 'tr',
    'thead': 'tr',
    'tfoot': 'tr',
    'colgroup': 'col',
    'select': 'option',
    'optgroup': 'option',
    'audio': 'source',
    'video': 'source',
    'object': 'param',
    'map': 'area'
  };
  
  return {
    /**
     * Returns best matched child element name for passed parent's
     * tag name
     * @param {String} name
     * @returns {String}
     * @memberOf tagName
     */
    resolve: function(name) {
      name = (name || '').toLowerCase();
      
      if (name in elementMap)
        return this.getMapping(name);
      
      if (this.isInlineLevel(name))
        return 'span';
      
      return 'div';
    },
    
    /**
     * Returns mapped child element name for passed parent's name 
     * @param {String} name
     * @returns {String}
     */
    getMapping: function(name) {
      return elementMap[name.toLowerCase()];
    },
    
    /**
     * Check if passed element name belongs to inline-level element
     * @param {String} name
     * @returns {Boolean}
     */
    isInlineLevel: function(name) {
      return this.isTypeOf(name, 'inlineLevel');
    },
    
    /**
     * Check if passed element belongs to block-level element.
     * For better matching of unknown elements (for XML, for example), 
     * you should use <code>!this.isInlineLevel(name)</code>
     * @returns {Boolean}
     */
    isBlockLevel: function(name) {
      return this.isTypeOf(name, 'blockLevel');
    },
    
    /**
     * Check if passed element is void (i.e. should not have closing tag).
     * @returns {Boolean}
     */
    isEmptyElement: function(name) {
      return this.isTypeOf(name, 'empty');
    },
    
    /**
     * Generic function for testing if element name belongs to specified
     * elements collection
     * @param {String} name Element name
     * @param {String} type Collection name
     * @returns {Boolean}
     */
    isTypeOf: function(name, type) {
      return _.include(elementTypes[type], name);
    },
    
    /**
     * Adds new parent–child mapping
     * @param {String} parent
     * @param {String} child
     */
    addMapping: function(parent, child) {
      elementMap[parent] = child;
    },
    
    /**
     * Removes parent-child mapping
     */
    removeMapping: function(parent) {
      if (parent in elementMap)
        delete elementMap[parent];
    },
    
    /**
     * Adds new element into collection
     * @param {String} name Element name
     * @param {String} collection Collection name
     */
    addElementToCollection: function(name, collection) {
      if (!elementTypes[collection])
        elementTypes[collection] = [];
      
      var col = this.getCollection(collection);
      if (!_.include(col, name))
        col.push(name);
    },
    
    /**
     * Removes element name from specified collection
     * @param {String} name Element name
     * @param {String} collection Collection name
     * @returns
     */
    removeElementFromCollection: function(name, collection) {
      if (collection in elementTypes) {
        elementTypes[collection] = _.without(this.getCollection(collection), name);
      }
    },
    
    /**
     * Returns elements name collection
     * @param {String} name Collection name
     * @returns {Array}
     */
    getCollection: function(name) {
      return elementTypes[name];
    }
  };
});/**
 * Filter for aiding of writing elements with complex class names as described
 * in Yandex's BEM (Block, Element, Modifier) methodology. This filter will
 * automatically inherit block and element names from parent elements and insert
 * them into child element classes
 * @memberOf __bemFilterDefine
 * @constructor
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  var prefs = require('preferences');
  prefs.define('bem.elementSeparator', '__', 'Class name’s element separator.');
  prefs.define('bem.modifierSeparator', '_', 'Class name’s modifier separator.');
  prefs.define('bem.shortElementPrefix', '-', 
      'Symbol for describing short “block-element” notation. Class names '
      + 'prefixed with this symbol will be treated as element name for parent‘s '
      + 'block name. Each symbol instance traverses one level up in parsed ' 
      + 'tree for block name lookup. Empty value will disable short notation.');
  
  var shouldRunHtmlFilter = false;
  
  function getSeparators() {
    return {
      element: prefs.get('bem.elementSeparator'),
      modifier: prefs.get('bem.modifierSeparator')
    };
  }
  
  /**
   * @param {AbbreviationNode} item
   */
  function bemParse(item) {
    if (require('abbreviationUtils').isSnippet(item))
      return item;
    
    // save BEM stuff in cache for faster lookups
    item.__bem = {
      block: '',
      element: '',
      modifier: ''
    };
    
    var classNames = normalizeClassName(item.attribute('class')).split(' ');
    
    // guess best match for block name
    var reBlockName = /^[a-z]\-/i;
    item.__bem.block = _.find(classNames, function(name) {
      return reBlockName.test(name);
    });
    
    // guessing doesn't worked, pick first class name as block name
    if (!item.__bem.block) {
      reBlockName = /^[a-z]/i;
      item.__bem.block = _.find(classNames, function(name) {
        return reBlockName.test(name);
      }) || '';
    }
    
    classNames = _.chain(classNames)
      .map(function(name) {return processClassName(name, item);})
      .flatten()
      .uniq()
      .value()
      .join(' ');
    
    if (classNames)
      item.attribute('class', classNames);
    
    return item;
  }
  
  /**
   * @param {String} className
   * @returns {String}
   */
  function normalizeClassName(className) {
    var utils = require('utils');
    className = (' ' + (className || '') + ' ').replace(/\s+/g, ' ');
    
    var shortSymbol = prefs.get('bem.shortElementPrefix');
    if (shortSymbol) {
      var re = new RegExp('\\s(' + utils.escapeForRegexp(shortSymbol) + '+)', 'g');
      className = className.replace(re, function(str, p1) {
        return ' ' + utils.repeatString(getSeparators().element, p1.length);
      });
    }
    
    return utils.trim(className);
  }
  
  /**
   * Processes class name
   * @param {String} name Class name item to process
   * @param {AbbreviationNode} item Host node for provided class name
   * @returns Processed class name. May return <code>Array</code> of
   * class names 
   */
  function processClassName(name, item) {
    name = transformClassName(name, item, 'element');
    name = transformClassName(name, item, 'modifier');
    
    // expand class name
    // possible values:
    // * block__element
    // * block__element_modifier
    // * block__element_modifier1_modifier2
    // * block_modifier
    var block = '', element = '', modifier = '';
    var separators = getSeparators();
    if (~name.indexOf(separators.element)) {
      var blockElem = name.split(separators.element);
      var elemModifiers = blockElem[1].split(separators.modifier);
      
      block = blockElem[0];
      element = elemModifiers.shift();
      modifier = elemModifiers.join(separators.modifier);
    } else if (~name.indexOf(separators.modifier)) {
      var blockModifiers = name.split(separators.modifier);
      
      block = blockModifiers.shift();
      modifier = blockModifiers.join(separators.modifier);
    }
    
    if (block || element || modifier) {
      if (!block) {
        block = item.__bem.block;
      }
      
      // inherit parent bem element, if exists
//      if (item.parent && item.parent.__bem && item.parent.__bem.element)
//        element = item.parent.__bem.element + separators.element + element;
      
      // produce multiple classes
      var prefix = block;
      var result = [];
      
      if (element) {
        prefix += separators.element + element;
        result.push(prefix);
      } else {
        result.push(prefix);
      }
      
      if (modifier) {
        result.push(prefix + separators.modifier + modifier);
      }
      
      item.__bem.block = block;
      item.__bem.element = element;
      item.__bem.modifier = modifier;
      
      return result;
    }
    
    // ...otherwise, return processed or original class name
    return name;
  }
  
  /**
   * Low-level function to transform user-typed class name into full BEM class
   * @param {String} name Class name item to process
   * @param {AbbreviationNode} item Host node for provided class name
   * @param {String} entityType Type of entity to be tried to transform 
   * ('element' or 'modifier')
   * @returns {String} Processed class name or original one if it can't be
   * transformed
   */
  function transformClassName(name, item, entityType) {
    var separators = getSeparators();
    var reSep = new RegExp('^(' + separators[entityType] + ')+', 'g');
    if (reSep.test(name)) {
      var depth = 0; // parent lookup depth
      var cleanName = name.replace(reSep, function(str, p1) {
        depth = str.length / separators[entityType].length;
        return '';
      });
      
      // find donor element
      var donor = item;
      while (donor.parent && depth--) {
        donor = donor.parent;
      }
      
      if (!donor || !donor.__bem)
        donor = item;
      
      if (donor && donor.__bem) {
        var prefix = donor.__bem.block;
        
        // decide if we should inherit element name
//        if (entityType == 'element') {
//          var curElem = cleanName.split(separators.modifier, 1)[0];
//          if (donor.__bem.element && donor.__bem.element != curElem)
//            prefix += separators.element + donor.__bem.element;
//        }
        
        if (entityType == 'modifier' &&  donor.__bem.element)
          prefix += separators.element + donor.__bem.element;
        
        return prefix + separators[entityType] + cleanName;
      }
    }
    
    return name;
  }
  
  /**
   * Recursive function for processing tags, which extends class names 
   * according to BEM specs: http://bem.github.com/bem-method/pages/beginning/beginning.ru.html
   * <br><br>
   * It does several things:<br>
   * <ul>
   * <li>Expands complex class name (according to BEM symbol semantics):
   * .block__elem_modifier → .block.block__elem.block__elem_modifier
   * </li>
   * <li>Inherits block name on child elements: 
   * .b-block > .__el > .__el → .b-block > .b-block__el > .b-block__el__el
   * </li>
   * <li>Treats first dash symbol as '__'</li>
   * <li>Double underscore (or typographic '–') is also treated as an element 
   * level lookup, e.g. ____el will search for element definition in parent’s 
   * parent element:
   * .b-block > .__el1 > .____el2 → .b-block > .b-block__el1 > .b-block__el2
   * </li>
   * </ul>
   * 
   * @param {AbbreviationNode} tree
   * @param {Object} profile
   */
  function process(tree, profile) {
    if (tree.name)
      bemParse(tree, profile);
    
    var abbrUtils = require('abbreviationUtils');
    _.each(tree.children, function(item) {
      process(item, profile);
      if (!abbrUtils.isSnippet(item) && item.start)
        shouldRunHtmlFilter = true;
    });
    
    return tree;
  };
  
  require('filters').add('bem', function(tree, profile) {
    shouldRunHtmlFilter = false;
    tree = process(tree, profile);
    // in case 'bem' filter is applied after 'html' filter: run it again
    // to update output
    if (shouldRunHtmlFilter) {
      tree = require('filters').apply(tree, 'html', profile);
    }
    
    return tree;
  });
});

/**
 * Comment important tags (with 'id' and 'class' attributes)
 * @author Sergey Chikuyonok (serge.che@gmail.com)
 * @link http://chikuyonok.ru
 * @constructor
 * @memberOf __commentFilterDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  // define some preferences
  /** @type emmet.preferences */
  var prefs = require('preferences');
  
  prefs.define('filter.commentAfter', 
      '\n<!-- /<%= attr("id", "#") %><%= attr("class", ".") %> -->',
      'A definition of comment that should be placed <i>after</i> matched '
      + 'element when <code>comment</code> filter is applied. This definition '
      + 'is an ERB-style template passed to <code>_.template()</code> '
      + 'function (see Underscore.js docs for details). In template context, '
      + 'the following properties and functions are availabe:\n'
      + '<ul>'
      
      + '<li><code>attr(name, before, after)</code> – a function that outputs' 
      + 'specified attribute value concatenated with <code>before</code> ' 
      + 'and <code>after</code> strings. If attribute doesn\'t exists, the ' 
      + 'empty string will be returned.</li>'
      
      + '<li><code>node</code> – current node (instance of <code>AbbreviationNode</code>)</li>'
      
      + '<li><code>name</code> – name of current tag</li>'
      
      + '<li><code>padding</code> – current string padding, can be used ' 
      + 'for formatting</li>'
      
      +'</ul>');
  
  prefs.define('filter.commentBefore', 
      '',
      'A definition of comment that should be placed <i>before</i> matched '
      + 'element when <code>comment</code> filter is applied. '
      + 'For more info, read description of <code>filter.commentAfter</code> '
      + 'property');
  
  prefs.define('filter.commentTrigger', 'id, class',
      'A comma-separated list of attribute names that should exist in abbreviatoin '
      + 'where comment should be added. If you wish to add comment for '
      + 'every element, set this option to <code>*</code>');
  
  /**
   * Add comments to tag
   * @param {AbbreviationNode} node
   */
  function addComments(node, templateBefore, templateAfter) {
    var utils = require('utils');
    
    // check if comments should be added
    var trigger = prefs.get('filter.commentTrigger');
    if (trigger != '*') {
      var shouldAdd = _.find(trigger.split(','), function(name) {
        return !!node.attribute(utils.trim(name));
      });
      if (!shouldAdd) return;
    }
    
    var ctx = {
      node: node,
      name: node.name(),
      padding: node.parent ? node.parent.padding : '',
      attr: function(name, before, after) {
        var attr = node.attribute(name);
        if (attr) {
          return (before || '') + attr + (after || '');
        }
        
        return '';
      }
    };
    
    var nodeBefore = utils.normalizeNewline(templateBefore ? templateBefore(ctx) : '');
    var nodeAfter = utils.normalizeNewline(templateAfter ? templateAfter(ctx) : '');
    
    node.start = node.start.replace(/</, nodeBefore + '<');
    node.end = node.end.replace(/>/, '>' + nodeAfter);
  }
  
  function process(tree, before, after) {
    var abbrUtils = require('abbreviationUtils');
    _.each(tree.children, function(item) {
      if (abbrUtils.isBlock(item))
        addComments(item, before, after);
      
      process(item, before, after);
    });
      
    return tree;
  }
  
  require('filters').add('c', function(tree) {
    var templateBefore = _.template(prefs.get('filter.commentBefore'));
    var templateAfter = _.template(prefs.get('filter.commentAfter'));
    
    return process(tree, templateBefore, templateAfter);
  });
});
/**
 * Filter for escaping unsafe XML characters: <, >, &
 * @author Sergey Chikuyonok (serge.che@gmail.com)
 * @link http://chikuyonok.ru
 */
emmet.exec(function(require, _) {
  var charMap = {
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;'
  };
  
  function escapeChars(str) {
    return str.replace(/([<>&])/g, function(str, p1){
      return charMap[p1];
    });
  }
  
  require('filters').add('e', function process(tree) {
    _.each(tree.children, function(item) {
      item.start = escapeChars(item.start);
      item.end = escapeChars(item.end);
      item.content = escapeChars(item.content);
      process(item);
    });
    
    return tree;
  });
});/**
 * Generic formatting filter: creates proper indentation for each tree node,
 * placing "%s" placeholder where the actual output should be. You can use
 * this filter to preformat tree and then replace %s placeholder to whatever you
 * need. This filter should't be called directly from editor as a part 
 * of abbreviation.
 * @author Sergey Chikuyonok (serge.che@gmail.com)
 * @link http://chikuyonok.ru
 * @constructor
 * @memberOf __formatFilterDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _){
  var placeholder = '%s';
  
  /** @type preferences */
  var prefs = require('preferences');
  prefs.define('format.noIndentTags', 'html', 
      'A comma-separated list of tag names that should not get inner indentation.');
  
  prefs.define('format.forceIndentationForTags', 'body', 
    'A comma-separated list of tag names that should <em>always</em> get inner indentation.');
  
  /**
   * Get indentation for given node
   * @param {AbbreviationNode} node
   * @returns {String}
   */
  function getIndentation(node) {
    if (_.include(prefs.getArray('format.noIndentTags') || [], node.name())) {
      return '';
    }
    
    return require('resources').getVariable('indentation');
  }
  
  /**
   * Test if passed node has block-level sibling element
   * @param {AbbreviationNode} item
   * @return {Boolean}
   */
  function hasBlockSibling(item) {
    return item.parent && require('abbreviationUtils').hasBlockChildren(item.parent);
  }
  
  /**
   * Test if passed item is very first child in parsed tree
   * @param {AbbreviationNode} item
   */
  function isVeryFirstChild(item) {
    return item.parent && !item.parent.parent && !item.index();
  }
  
  /**
   * Check if a newline should be added before element
   * @param {AbbreviationNode} node
   * @param {OutputProfile} profile
   * @return {Boolean}
   */
  function shouldAddLineBreak(node, profile) {
    var abbrUtils = require('abbreviationUtils');
    if (profile.tag_nl === true || abbrUtils.isBlock(node))
      return true;
    
    if (!node.parent || !profile.inline_break)
      return false;
    
    // check if there are required amount of adjacent inline element
    return shouldFormatInline(node.parent, profile);
}
  
  /**
   * Need to add newline because <code>item</code> has too many inline children
   * @param {AbbreviationNode} node
   * @param {OutputProfile} profile
   */
  function shouldBreakChild(node, profile) {
    // we need to test only one child element, because 
    // hasBlockChildren() method will do the rest
    return node.children.length && shouldAddLineBreak(node.children[0], profile);
  }
  
  function shouldFormatInline(node, profile) {
    var nodeCount = 0;
    var abbrUtils = require('abbreviationUtils');
    return !!_.find(node.children, function(child) {
      if (child.isTextNode() || !abbrUtils.isInline(child))
        nodeCount = 0;
      else if (abbrUtils.isInline(child))
        nodeCount++;
      
      if (nodeCount >= profile.inline_break)
        return true;
    });
  }
  
  function isRoot(item) {
    return !item.parent;
  }
  
  /**
   * Processes element with matched resource of type <code>snippet</code>
   * @param {AbbreviationNode} item
   * @param {OutputProfile} profile
   * @param {Number} level Depth level
   */
  function processSnippet(item, profile, level) {
    item.start = item.end = '';
    if (!isVeryFirstChild(item) && profile.tag_nl !== false && shouldAddLineBreak(item, profile)) {
      // check if we’re not inside inline element
      if (isRoot(item.parent) || !require('abbreviationUtils').isInline(item.parent)) {
        item.start = require('utils').getNewline() + item.start;
      }
    }
    
    return item;
  }
  
  /**
   * Check if we should add line breaks inside inline element
   * @param {AbbreviationNode} node
   * @param {OutputProfile} profile
   * @return {Boolean}
   */
  function shouldBreakInsideInline(node, profile) {
    var abbrUtils = require('abbreviationUtils');
    var hasBlockElems = _.any(node.children, function(child) {
      if (abbrUtils.isSnippet(child))
        return false;
      
      return !abbrUtils.isInline(child);
    });
    
    if (!hasBlockElems) {
      return shouldFormatInline(node, profile);
    }
    
    return true;
  }
  
  /**
   * Processes element with <code>tag</code> type
   * @param {AbbreviationNode} item
   * @param {OutputProfile} profile
   * @param {Number} level Depth level
   */
  function processTag(item, profile, level) {
    item.start = item.end = placeholder;
    var utils = require('utils');
    var abbrUtils = require('abbreviationUtils');
    var isUnary = abbrUtils.isUnary(item);
    var nl = utils.getNewline();
    var indent = getIndentation(item);
      
    // formatting output
    if (profile.tag_nl !== false) {
      var forceNl = profile.tag_nl === true && (profile.tag_nl_leaf || item.children.length);
      if (!forceNl) {
        forceNl = _.include(prefs.getArray('format.forceIndentationForTags') || [], item.name());
      }
      
      // formatting block-level elements
      if (!item.isTextNode()) {
        if (shouldAddLineBreak(item, profile)) {
          // - do not indent the very first element
          // - do not indent first child of a snippet
          if (!isVeryFirstChild(item) && (!abbrUtils.isSnippet(item.parent) || item.index()))
            item.start = nl + item.start;
            
          if (abbrUtils.hasBlockChildren(item) || shouldBreakChild(item, profile) || (forceNl && !isUnary))
            item.end = nl + item.end;
            
          if (abbrUtils.hasTagsInContent(item) || (forceNl && !item.children.length && !isUnary))
            item.start += nl + indent;
        } else if (abbrUtils.isInline(item) && hasBlockSibling(item) && !isVeryFirstChild(item)) {
          item.start = nl + item.start;
        } else if (abbrUtils.isInline(item) && shouldBreakInsideInline(item, profile)) {
          item.end = nl + item.end;
        }
        
        item.padding = indent;
      }
    }
    
    return item;
  }
  
  /**
   * Processes simplified tree, making it suitable for output as HTML structure
   * @param {AbbreviationNode} tree
   * @param {OutputProfile} profile
   * @param {Number} level Depth level
   */
  require('filters').add('_format', function process(tree, profile, level) {
    level = level || 0;
    var abbrUtils = require('abbreviationUtils');
    
    _.each(tree.children, function(item) {
      if (abbrUtils.isSnippet(item))
        processSnippet(item, profile, level);
      else
        processTag(item, profile, level);
      
      process(item, profile, level + 1);
    });
    
    return tree;
  });
});/**
 * Filter for producing HAML code from abbreviation.
 * @author Sergey Chikuyonok (serge.che@gmail.com)
 * @link http://chikuyonok.ru
 * @constructor
 * @memberOf __hamlFilterDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  var childToken = '${child}';
  
  function transformClassName(className) {
    return require('utils').trim(className).replace(/\s+/g, '.');
  }
  
  /**
   * Creates HAML attributes string from tag according to profile settings
   * @param {AbbreviationNode} tag
   * @param {Object} profile
   */
  function makeAttributesString(tag, profile) {
    var attrs = '';
    var otherAttrs = [];
    var attrQuote = profile.attributeQuote();
    var cursor = profile.cursor();
    
    _.each(tag.attributeList(), function(a) {
      var attrName = profile.attributeName(a.name);
      switch (attrName.toLowerCase()) {
        // use short notation for ID and CLASS attributes
        case 'id':
          attrs += '#' + (a.value || cursor);
          break;
        case 'class':
          attrs += '.' + transformClassName(a.value || cursor);
          break;
        // process other attributes
        default:
          otherAttrs.push(':' +attrName + ' => ' + attrQuote + (a.value || cursor) + attrQuote);
      }
    });
    
    if (otherAttrs.length)
      attrs += '{' + otherAttrs.join(', ') + '}';
    
    return attrs;
  }
  
  /**
   * Test if passed node has block-level sibling element
   * @param {AbbreviationNode} item
   * @return {Boolean}
   */
  function hasBlockSibling(item) {
    return item.parent && item.parent.hasBlockChildren();
  }
  
  /**
   * Processes element with <code>tag</code> type
   * @param {AbbreviationNode} item
   * @param {OutputProfile} profile
   * @param {Number} level Depth level
   */
  function processTag(item, profile, level) {
    if (!item.parent)
      // looks like it's root element
      return item;
    
    var abbrUtils = require('abbreviationUtils');
    var utils = require('utils');
    
    var attrs = makeAttributesString(item, profile);
    var cursor = profile.cursor();
    var isUnary = abbrUtils.isUnary(item);
    var selfClosing = profile.self_closing_tag && isUnary ? '/' : '';
    var start= '';
      
    // define tag name
    var tagName = '%' + profile.tagName(item.name());
    if (tagName.toLowerCase() == '%div' && attrs && attrs.indexOf('{') == -1)
      // omit div tag
      tagName = '';
      
    item.end = '';
    start = tagName + attrs + selfClosing + ' ';
    
    var placeholder = '%s';
    // We can't just replace placeholder with new value because
    // JavaScript will treat double $ character as a single one, assuming
    // we're using RegExp literal.
    item.start = utils.replaceSubstring(item.start, start, item.start.indexOf(placeholder), placeholder);
    
    if (!item.children.length && !isUnary)
      item.start += cursor;
    
    return item;
  }
  
  /**
   * Processes simplified tree, making it suitable for output as HTML structure
   * @param {AbbreviationNode} tree
   * @param {Object} profile
   * @param {Number} level Depth level
   */
  require('filters').add('haml', function process(tree, profile, level) {
    level = level || 0;
    var abbrUtils = require('abbreviationUtils');
    
    if (!level) {
      tree = require('filters').apply(tree, '_format', profile);
    }
    
    _.each(tree.children, function(item) {
      if (!abbrUtils.isSnippet(item))
        processTag(item, profile, level);
      
      process(item, profile, level + 1);
    });
    
    return tree;
  });
});/**
 * Filter that produces HTML tree
 * @author Sergey Chikuyonok (serge.che@gmail.com)
 * @link http://chikuyonok.ru
 * @constructor
 * @memberOf __htmlFilterDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  /**
   * Creates HTML attributes string from tag according to profile settings
   * @param {AbbreviationNode} node
   * @param {OutputProfile} profile
   */
  function makeAttributesString(node, profile) {
    var attrQuote = profile.attributeQuote();
    var cursor = profile.cursor();
    
    return _.map(node.attributeList(), function(a) {
      var attrName = profile.attributeName(a.name);
      return ' ' + attrName + '=' + attrQuote + (a.value || cursor) + attrQuote;
    }).join('');
  }
  
  /**
   * Processes element with <code>tag</code> type
   * @param {AbbreviationNode} item
   * @param {OutputProfile} profile
   * @param {Number} level Depth level
   */
  function processTag(item, profile, level) {
    if (!item.parent) // looks like it's root element
      return item;
    
    var abbrUtils = require('abbreviationUtils');
    var utils = require('utils');
    
    var attrs = makeAttributesString(item, profile); 
    var cursor = profile.cursor();
    var isUnary = abbrUtils.isUnary(item);
    var start= '';
    var end = '';
      
    // define opening and closing tags
    if (!item.isTextNode()) {
      var tagName = profile.tagName(item.name());
      if (isUnary) {
        start = '<' + tagName + attrs + profile.selfClosing() + '>';
        item.end = '';
      } else {
        start = '<' + tagName + attrs + '>';
        end = '</' + tagName + '>';
      }
    }
    
    var placeholder = '%s';
    // We can't just replace placeholder with new value because
    // JavaScript will treat double $ character as a single one, assuming
    // we're using RegExp literal.
    item.start = utils.replaceSubstring(item.start, start, item.start.indexOf(placeholder), placeholder);
    item.end = utils.replaceSubstring(item.end, end, item.end.indexOf(placeholder), placeholder);
    
    // should we put caret placeholder after opening tag?
    if (
        !item.children.length 
        && !isUnary 
        && !~item.content.indexOf(cursor)
        && !require('tabStops').extract(item.content).tabstops.length
      ) {
      item.start += cursor;
    }
    
    return item;
  }
  
  /**
   * Processes simplified tree, making it suitable for output as HTML structure
   * @param {AbbreviationNode} tree
   * @param {Object} profile
   * @param {Number} level Depth level
   */
  require('filters').add('html', function process(tree, profile, level) {
    level = level || 0;
    var abbrUtils = require('abbreviationUtils');
    
    if (!level) {
      tree = require('filters').apply(tree, '_format', profile);
    }
    
    _.each(tree.children, function(item) {
      if (!abbrUtils.isSnippet(item))
        processTag(item, profile, level);
      
      process(item, profile, level + 1);
    });
    
    return tree;
  });
});/**
 * Output abbreviation on a single line (i.e. no line breaks)
 * @author Sergey Chikuyonok (serge.che@gmail.com)
 * @link http://chikuyonok.ru
 * @constructor
 * @memberOf __singleLineFilterDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  var rePad = /^\s+/;
  var reNl = /[\n\r]/g;
  
  require('filters').add('s', function process(tree, profile, level) {
    var abbrUtils = require('abbreviationUtils');
    
    _.each(tree.children, function(item) {
      if (!abbrUtils.isSnippet(item)) {
        // remove padding from item 
        item.start = item.start.replace(rePad, '');
        item.end = item.end.replace(rePad, '');
      }
      
      // remove newlines 
      item.start = item.start.replace(reNl, '');
      item.end = item.end.replace(reNl, '');
      item.content = item.content.replace(reNl, '');
      
      process(item);
    });
    
    return tree;
  });
});
/**
 * Trim filter: removes characters at the beginning of the text
 * content that indicates lists: numbers, #, *, -, etc.
 * 
 * Useful for wrapping lists with abbreviation.
 * 
 * @author Sergey Chikuyonok (serge.che@gmail.com)
 * @link http://chikuyonok.ru
 * 
 * @constructor
 * @memberOf __trimFilterDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  require('preferences').define('filter.trimRegexp', '[\\s|\\u00a0]*[\\d|#|\\-|\*|\\u2022]+\\.?\\s*',
      'Regular expression used to remove list markers (numbers, dashes, ' 
      + 'bullets, etc.) in <code>t</code> (trim) filter. The trim filter '
      + 'is useful for wrapping with abbreviation lists, pased from other ' 
      + 'documents (for example, Word documents).');
  
  function process(tree, re) {
    _.each(tree.children, function(item) {
      if (item.content)
        item.content = item.content.replace(re, '');
      
      process(item, re);
    });
    
    return tree;
  }
  
  require('filters').add('t', function(tree) {
    var re = new RegExp(require('preferences').get('filter.trimRegexp'));
    return process(tree, re);
  });
});
/**
 * Filter for trimming "select" attributes from some tags that contains
 * child elements
 * @author Sergey Chikuyonok (serge.che@gmail.com)
 * @link http://chikuyonok.ru
 * 
 * @constructor
 * @memberOf __xslFilterDefine
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.exec(function(require, _) {
  var tags = {
    'xsl:variable': 1,
    'xsl:with-param': 1
  };
  
  /**
   * Removes "select" attribute from node
   * @param {AbbreviationNode} node
   */
  function trimAttribute(node) {
    node.start = node.start.replace(/\s+select\s*=\s*(['"]).*?\1/, '');
  }
  
  require('filters').add('xsl', function process(tree) {
    var abbrUtils = require('abbreviationUtils');
    _.each(tree.children, function(item) {
      if (!abbrUtils.isSnippet(item)
          && (item.name() || '').toLowerCase() in tags 
          && item.children.length)
        trimAttribute(item);
      process(item);
    });
    
    return tree;
  });
});/**
 * "Lorem ipsum" text generator. Matches <code>lipsum(num)?</code> or 
 * <code>lorem(num)?</code> abbreviation.
 * This code is based on Django's contribution: 
 * https://code.djangoproject.com/browser/django/trunk/django/contrib/webdesign/lorem_ipsum.py
 * <br><br>
 * Examples to test:<br>
 * <code>lipsum</code> – generates 30 words text.<br>
 * <code>lipsum*6</code> – generates 6 paragraphs (autowrapped with &lt;p&gt; element) of text.<br>
 * <code>ol>lipsum10*5</code> — generates ordered list with 5 list items (autowrapped with &lt;li&gt; tag)
 * with text of 10 words on each line<br>
 * <code>span*3>lipsum20</code> – generates 3 paragraphs of 20-words text, each wrapped with &lt;span&gt; element .
 * Each paragraph phrase is unique   
 * @param {Function} require
 * @param {Underscore} _ 
 * @constructor
 * @memberOf __loremIpsumGeneratorDefine
 */
emmet.exec(function(require, _) {
  /**
   * @param {AbbreviationNode} tree
   * @param {Object} options
   */
  require('abbreviationParser').addPreprocessor(function(tree, options) {
    var re = /^(?:lorem|lipsum)(\d*)$/i, match;
    
    /** @param {AbbreviationNode} node */
    tree.findAll(function(node) {
      if (node._name && (match = node._name.match(re))) {
        var wordCound = match[1] || 30;
        
        // force node name resolving if node should be repeated
        // or contains attributes. In this case, node should be outputed
        // as tag, otherwise as text-only node
        node._name = '';
        node.data('forceNameResolving', node.isRepeating() || node.attributeList().length);
        node.data('pasteOverwrites', true);
        node.data('paste', function(i, content) {
          return paragraph(wordCound, !i);
        });
      }
    });
  });
  
  var COMMON_P = 'lorem ipsum dolor sit amet consectetur adipisicing elit'.split(' ');
  
  var WORDS = ['exercitationem', 'perferendis', 'perspiciatis', 'laborum', 'eveniet',
               'sunt', 'iure', 'nam', 'nobis', 'eum', 'cum', 'officiis', 'excepturi',
               'odio', 'consectetur', 'quasi', 'aut', 'quisquam', 'vel', 'eligendi',
               'itaque', 'non', 'odit', 'tempore', 'quaerat', 'dignissimos',
               'facilis', 'neque', 'nihil', 'expedita', 'vitae', 'vero', 'ipsum',
               'nisi', 'animi', 'cumque', 'pariatur', 'velit', 'modi', 'natus',
               'iusto', 'eaque', 'sequi', 'illo', 'sed', 'ex', 'et', 'voluptatibus',
               'tempora', 'veritatis', 'ratione', 'assumenda', 'incidunt', 'nostrum',
               'placeat', 'aliquid', 'fuga', 'provident', 'praesentium', 'rem',
               'necessitatibus', 'suscipit', 'adipisci', 'quidem', 'possimus',
               'voluptas', 'debitis', 'sint', 'accusantium', 'unde', 'sapiente',
               'voluptate', 'qui', 'aspernatur', 'laudantium', 'soluta', 'amet',
               'quo', 'aliquam', 'saepe', 'culpa', 'libero', 'ipsa', 'dicta',
               'reiciendis', 'nesciunt', 'doloribus', 'autem', 'impedit', 'minima',
               'maiores', 'repudiandae', 'ipsam', 'obcaecati', 'ullam', 'enim',
               'totam', 'delectus', 'ducimus', 'quis', 'voluptates', 'dolores',
               'molestiae', 'harum', 'dolorem', 'quia', 'voluptatem', 'molestias',
               'magni', 'distinctio', 'omnis', 'illum', 'dolorum', 'voluptatum', 'ea',
               'quas', 'quam', 'corporis', 'quae', 'blanditiis', 'atque', 'deserunt',
               'laboriosam', 'earum', 'consequuntur', 'hic', 'cupiditate',
               'quibusdam', 'accusamus', 'ut', 'rerum', 'error', 'minus', 'eius',
               'ab', 'ad', 'nemo', 'fugit', 'officia', 'at', 'in', 'id', 'quos',
               'reprehenderit', 'numquam', 'iste', 'fugiat', 'sit', 'inventore',
               'beatae', 'repellendus', 'magnam', 'recusandae', 'quod', 'explicabo',
               'doloremque', 'aperiam', 'consequatur', 'asperiores', 'commodi',
               'optio', 'dolor', 'labore', 'temporibus', 'repellat', 'veniam',
               'architecto', 'est', 'esse', 'mollitia', 'nulla', 'a', 'similique',
               'eos', 'alias', 'dolore', 'tenetur', 'deleniti', 'porro', 'facere',
               'maxime', 'corrupti'];
  
  /**
   * Returns random integer between <code>from</code> and <code>to</code> values
   * @param {Number} from
   * @param {Number} to
   * @returns {Number}
   */
  function randint(from, to) {
    return Math.round(Math.random() * (to - from) + from);
  }
  
  /**
   * @param {Array} arr
   * @param {Number} count
   * @returns {Array}
   */
  function sample(arr, count) {
    var len = arr.length;
    var iterations = Math.min(len, count);
    var result = [];
    while (result.length < iterations) {
      var randIx = randint(0, len - 1);
      if (!_.include(result, randIx))
        result.push(randIx);
    }
    
    return _.map(result, function(ix) {
      return arr[ix];
    });
  }
  
  function choice(val) {
    if (_.isString(val))
      return val.charAt(randint(0, val.length - 1));
    
    return val[randint(0, val.length - 1)];
  }
  
  function sentence(words, end) {
    if (words.length) {
      words[0] = words[0].charAt(0).toUpperCase() + words[0].substring(1);
    }
    
    return words.join(' ') + (end || choice('?!...')); // more dots that question marks
  }
  
  /**
   * Insert commas at randomly selected words. This function modifies values
   * inside <code>words</code> array 
   * @param {Array} words
   */
  function insertCommas(words) {
    var len = words.length;
    var totalCommas = 0;
    
    if (len > 3 && len <= 6) {
      totalCommas = randint(0, 1);
    } else if (len > 6 && len <= 12) {
      totalCommas = randint(0, 2);
    } else {
      totalCommas = randint(1, 4);
    }
    
    _.each(sample(_.range(totalCommas)), function(ix) {
      words[ix] += ',';
    });
  }
  
  /**
   * Generate a paragraph of "Lorem ipsum" text
   * @param {Number} wordCount Words count in paragraph
   * @param {Boolean} startWithCommon Should paragraph start with common 
   * "lorem ipsum" sentence.
   * @returns {String}
   */
  function paragraph(wordCount, startWithCommon) {
    var result = [];
    var totalWords = 0;
    var words;
    
    wordCount = parseInt(wordCount, 10);
    
    if (startWithCommon) {
      words = COMMON_P.slice(0, wordCount);
      if (words.length > 5)
        words[4] += ',';
      totalWords += words.length;
      result.push(sentence(words, '.'));
    }
    
    while (totalWords < wordCount) {
      words = sample(WORDS, Math.min(randint(3, 12) * randint(1, 5), wordCount - totalWords));
      totalWords += words.length;
      insertCommas(words);
      result.push(sentence(words));
    }
    
    return result.join(' ');
  }
});/**
 * Select current line (for simple editors like browser's &lt;textarea&gt;)
 */
emmet.exec(function(require, _) {
  require('actions').add('select_line', function(editor) {
    var range = editor.getCurrentLineRange();
    editor.createSelection(range.start, range.end);
    return true;
  });
});emmet.exec(function(require, _){require('resources').setVocabulary({
  "variables": {
    "lang": "en",
    "locale": "en-US",
    "charset": "UTF-8",
    "indentation": "\t",
    "newline": "\n"
  },
  
  "css": {
    "filters": "html",
    "snippets": {
      "@i": "@import url(|);",
      "@import": "@import url(|);",
      "@m": "@media ${1:screen} {\n\t|\n}",
      "@media": "@media ${1:screen} {\n\t|\n}",
      "@f": "@font-face {\n\tfont-family:|;\n\tsrc:url(|);\n}",
      "@f+": "@font-face {\n\tfont-family: '${1:FontName}';\n\tsrc: url('${2:FileName}.eot');\n\tsrc: url('${2:FileName}.eot?#iefix') format('embedded-opentype'),\n\t\t url('${2:FileName}.woff') format('woff'),\n\t\t url('${2:FileName}.ttf') format('truetype'),\n\t\t url('${2:FileName}.svg#${1:FontName}') format('svg');\n\tfont-style: ${3:normal};\n\tfont-weight: ${4:normal};\n}",

      "@kf": "@-webkit-keyframes ${1:identifier} {\n\t${2:from} { ${3} }${6}\n\t${4:to} { ${5} }\n}\n@-o-keyframes ${1:identifier} {\n\t${2:from} { ${3} }${6}\n\t${4:to} { ${5} }\n}\n@-moz-keyframes ${1:identifier} {\n\t${2:from} { ${3} }${6}\n\t${4:to} { ${5} }\n}\n@keyframes ${1:identifier} {\n\t${2:from} { ${3} }${6}\n\t${4:to} { ${5} }\n}",


      "anim": "animation:|;",
      "anim-": "animation:${1:name} ${2:duration} ${3:timing-function} ${4:delay} ${5:iteration-count} ${6:direction} ${7:fill-mode};",
      "animdel": "animation-delay:${1:time};",
      
      "animdir": "animation-direction:${1:normal};",
      "animdir:n": "animation-direction:normal;",
      "animdir:r": "animation-direction:reverse;",
      "animdir:a": "animation-direction:alternate;",
      "animdir:ar": "animation-direction:alternate-reverse;",
      
      "animdur": "animation-duration:${1:0}s;",
      
      "animfm": "animation-fill-mode:${1:both};",
      "animfm:f": "animation-fill-mode:forwards;",
      "animfm:b": "animation-fill-mode:backwards;",
      "animfm:bt": "animation-fill-mode:both;",
      "animfm:bh": "animation-fill-mode:both;",
      
      "animic": "animation-iteration-count:${1:1};",
      "animic:i": "animation-iteration-count:infinite;",
      
      "animn": "animation-name:${1:none};",

      "animps": "animation-play-state:${1:running};",
      "animps:p": "animation-play-state:paused;",
      "animps:r": "animation-play-state:running;",

      "animtf": "animation-timing-function:${1:linear};",
      "animtf:e": "animation-timing-function:ease;",
      "animtf:ei": "animation-timing-function:ease-in;",
      "animtf:eo": "animation-timing-function:ease-out;",
      "animtf:eio": "animation-timing-function:ease-in-out;",
      "animtf:l": "animation-timing-function:linear;",
      "animtf:cb": "animation-timing-function:cubic-bezier(${1:0.1}, ${2:0.7}, ${3:1.0}, ${3:0.1});",
      
      "ap": "appearance:${none}",

      "!": "!important",
      "pos": "position:${1:relative};",
      "pos:s": "position:static;",
      "pos:a": "position:absolute;",
      "pos:r": "position:relative;",
      "pos:f": "position:fixed;",
      "t": "top:|;",
      "t:a": "top:auto;",
      "r": "right:|;",
      "r:a": "right:auto;",
      "b": "bottom:|;",
      "b:a": "bottom:auto;",
      "l": "left:|;",
      "l:a": "left:auto;",
      "z": "z-index:|;",
      "z:a": "z-index:auto;",
      "fl": "float:${1:left};",
      "fl:n": "float:none;",
      "fl:l": "float:left;",
      "fl:r": "float:right;",
      "cl": "clear:${1:both};",
      "cl:n": "clear:none;",
      "cl:l": "clear:left;",
      "cl:r": "clear:right;",
      "cl:b": "clear:both;",

      "colm": "columns:|;",
      "colmc": "column-count:|;",
      "colmf": "column-fill:|;",
      "colmg": "column-gap:|;",
      "colmr": "column-rule:|;",
      "colmrc": "column-rule-color:|;",
      "colmrs": "column-rule-style:|;",
      "colmrw": "column-rule-width:|;",
      "colms": "column-span:|;",
      "colmw": "column-width:|;",

      "d": "display:${1:block};",
      "d:n": "display:none;",
      "d:b": "display:block;",
      "d:i": "display:inline;",
      "d:ib": "display:inline-block;",
      "d:li": "display:list-item;",
      "d:ri": "display:run-in;",
      "d:cp": "display:compact;",
      "d:tb": "display:table;",
      "d:itb": "display:inline-table;",
      "d:tbcp": "display:table-caption;",
      "d:tbcl": "display:table-column;",
      "d:tbclg": "display:table-column-group;",
      "d:tbhg": "display:table-header-group;",
      "d:tbfg": "display:table-footer-group;",
      "d:tbr": "display:table-row;",
      "d:tbrg": "display:table-row-group;",
      "d:tbc": "display:table-cell;",
      "d:rb": "display:ruby;",
      "d:rbb": "display:ruby-base;",
      "d:rbbg": "display:ruby-base-group;",
      "d:rbt": "display:ruby-text;",
      "d:rbtg": "display:ruby-text-group;",
      "v": "visibility:${1:hidden};",
      "v:v": "visibility:visible;",
      "v:h": "visibility:hidden;",
      "v:c": "visibility:collapse;",
      "ov": "overflow:${1:hidden};",
      "ov:v": "overflow:visible;",
      "ov:h": "overflow:hidden;",
      "ov:s": "overflow:scroll;",
      "ov:a": "overflow:auto;",
      "ovx": "overflow-x:${1:hidden};",
      "ovx:v": "overflow-x:visible;",
      "ovx:h": "overflow-x:hidden;",
      "ovx:s": "overflow-x:scroll;",
      "ovx:a": "overflow-x:auto;",
      "ovy": "overflow-y:${1:hidden};",
      "ovy:v": "overflow-y:visible;",
      "ovy:h": "overflow-y:hidden;",
      "ovy:s": "overflow-y:scroll;",
      "ovy:a": "overflow-y:auto;",
      "ovs": "overflow-style:${1:scrollbar};",
      "ovs:a": "overflow-style:auto;",
      "ovs:s": "overflow-style:scrollbar;",
      "ovs:p": "overflow-style:panner;",
      "ovs:m": "overflow-style:move;",
      "ovs:mq": "overflow-style:marquee;",
      "zoo": "zoom:1;",
      "zm": "zoom:1;",
      "cp": "clip:|;",
      "cp:a": "clip:auto;",
      "cp:r": "clip:rect(${1:top} ${2:right} ${3:bottom} ${4:left});",
      "bxz": "box-sizing:${1:border-box};",
      "bxz:cb": "box-sizing:content-box;",
      "bxz:bb": "box-sizing:border-box;",
      "bxsh": "box-shadow:${1:inset }${2:hoff} ${3:voff} ${4:blur} ${5:color};",
      "bxsh:r": "box-shadow:${1:inset }${2:hoff} ${3:voff} ${4:blur} ${5:spread }rgb(${6:0}, ${7:0}, ${8:0});",
      "bxsh:ra": "box-shadow:${1:inset }${2:h} ${3:v} ${4:blur} ${5:spread }rgba(${6:0}, ${7:0}, ${8:0}, .${9:5});",
      "bxsh:n": "box-shadow:none;",
      "m": "margin:|;",
      "m:a": "margin:auto;",
      "mt": "margin-top:|;",
      "mt:a": "margin-top:auto;",
      "mr": "margin-right:|;",
      "mr:a": "margin-right:auto;",
      "mb": "margin-bottom:|;",
      "mb:a": "margin-bottom:auto;",
      "ml": "margin-left:|;",
      "ml:a": "margin-left:auto;",
      "p": "padding:|;",
      "pt": "padding-top:|;",
      "pr": "padding-right:|;",
      "pb": "padding-bottom:|;",
      "pl": "padding-left:|;",
      "w": "width:|;",
      "w:a": "width:auto;",
      "h": "height:|;",
      "h:a": "height:auto;",
      "maw": "max-width:|;",
      "maw:n": "max-width:none;",
      "mah": "max-height:|;",
      "mah:n": "max-height:none;",
      "miw": "min-width:|;",
      "mih": "min-height:|;",
      "mar": "max-resolution:${1:res};",
      "mir": "min-resolution:${1:res};",
      "ori": "orientation:|;",
      "ori:l": "orientation:landscape;",
      "ori:p": "orientation:portrait;",
      "ol": "outline:|;",
      "ol:n": "outline:none;",
      "olo": "outline-offset:|;",
      "olw": "outline-width:|;",
      "ols": "outline-style:|;",
      "olc": "outline-color:#${1:000};",
      "olc:i": "outline-color:invert;",
      "bd": "border:|;",
      "bd+": "border:${1:1px} ${2:solid} ${3:#000};",
      "bd:n": "border:none;",
      "bdbk": "border-break:${1:close};",
      "bdbk:c": "border-break:close;",
      "bdcl": "border-collapse:|;",
      "bdcl:c": "border-collapse:collapse;",
      "bdcl:s": "border-collapse:separate;",
      "bdc": "border-color:#${1:000};",
      "bdc:t": "border-color:transparent;",
      "bdi": "border-image:url(|);",
      "bdi:n": "border-image:none;",
      "bdti": "border-top-image:url(|);",
      "bdti:n": "border-top-image:none;",
      "bdri": "border-right-image:url(|);",
      "bdri:n": "border-right-image:none;",
      "bdbi": "border-bottom-image:url(|);",
      "bdbi:n": "border-bottom-image:none;",
      "bdli": "border-left-image:url(|);",
      "bdli:n": "border-left-image:none;",
      "bdci": "border-corner-image:url(|);",
      "bdci:n": "border-corner-image:none;",
      "bdci:c": "border-corner-image:continue;",
      "bdtli": "border-top-left-image:url(|);",
      "bdtli:n": "border-top-left-image:none;",
      "bdtli:c": "border-top-left-image:continue;",
      "bdtri": "border-top-right-image:url(|);",
      "bdtri:n": "border-top-right-image:none;",
      "bdtri:c": "border-top-right-image:continue;",
      "bdbri": "border-bottom-right-image:url(|);",
      "bdbri:n": "border-bottom-right-image:none;",
      "bdbri:c": "border-bottom-right-image:continue;",
      "bdbli": "border-bottom-left-image:url(|);",
      "bdbli:n": "border-bottom-left-image:none;",
      "bdbli:c": "border-bottom-left-image:continue;",
      "bdf": "border-fit:${1:repeat};",
      "bdf:c": "border-fit:clip;",
      "bdf:r": "border-fit:repeat;",
      "bdf:sc": "border-fit:scale;",
      "bdf:st": "border-fit:stretch;",
      "bdf:ow": "border-fit:overwrite;",
      "bdf:of": "border-fit:overflow;",
      "bdf:sp": "border-fit:space;",
      "bdlen": "border-length:|;",
      "bdlen:a": "border-length:auto;",
      "bdsp": "border-spacing:|;",
      "bds": "border-style:|;",
      "bds:n": "border-style:none;",
      "bds:h": "border-style:hidden;",
      "bds:dt": "border-style:dotted;",
      "bds:ds": "border-style:dashed;",
      "bds:s": "border-style:solid;",
      "bds:db": "border-style:double;",
      "bds:dtds": "border-style:dot-dash;",
      "bds:dtdtds": "border-style:dot-dot-dash;",
      "bds:w": "border-style:wave;",
      "bds:g": "border-style:groove;",
      "bds:r": "border-style:ridge;",
      "bds:i": "border-style:inset;",
      "bds:o": "border-style:outset;",
      "bdw": "border-width:|;",
      "bdtw": "border-top-width:|;",
      "bdrw": "border-right-width:|;",
      "bdbw": "border-bottom-width:|;",
      "bdlw": "border-left-width:|;",
      "bdt": "border-top:|;",
      "bt": "border-top:|;",
      "bdt+": "border-top:${1:1px} ${2:solid} ${3:#000};",
      "bdt:n": "border-top:none;",
      "bdts": "border-top-style:|;",
      "bdts:n": "border-top-style:none;",
      "bdtc": "border-top-color:#${1:000};",
      "bdtc:t": "border-top-color:transparent;",
      "bdr": "border-right:|;",
      "br": "border-right:|;",
      "bdr+": "border-right:${1:1px} ${2:solid} ${3:#000};",
      "bdr:n": "border-right:none;",
      "bdrst": "border-right-style:|;",
      "bdrst:n": "border-right-style:none;",
      "bdrc": "border-right-color:#${1:000};",
      "bdrc:t": "border-right-color:transparent;",
      "bdb": "border-bottom:|;",
      "bb": "border-bottom:|;",
      "bdb+": "border-bottom:${1:1px} ${2:solid} ${3:#000};",
      "bdb:n": "border-bottom:none;",
      "bdbs": "border-bottom-style:|;",
      "bdbs:n": "border-bottom-style:none;",
      "bdbc": "border-bottom-color:#${1:000};",
      "bdbc:t": "border-bottom-color:transparent;",
      "bdl": "border-left:|;",
      "bl": "border-left:|;",
      "bdl+": "border-left:${1:1px} ${2:solid} ${3:#000};",
      "bdl:n": "border-left:none;",
      "bdls": "border-left-style:|;",
      "bdls:n": "border-left-style:none;",
      "bdlc": "border-left-color:#${1:000};",
      "bdlc:t": "border-left-color:transparent;",
      "bdrs": "border-radius:|;",
      "bdtrrs": "border-top-right-radius:|;",
      "bdtlrs": "border-top-left-radius:|;",
      "bdbrrs": "border-bottom-right-radius:|;",
      "bdblrs": "border-bottom-left-radius:|;",
      "bg": "background:|;",
      "bg+": "background:${1:#fff} url(${2}) ${3:0} ${4:0} ${5:no-repeat};",
      "bg:n": "background:none;",
      "bg:ie": "filter:progid:DXImageTransform.Microsoft.AlphaImageLoader(src='${1:x}.png',sizingMethod='${2:crop}');",
      "bgc": "background-color:#${1:fff};",
      "bgc:t": "background-color:transparent;",
      "bgi": "background-image:url(|);",
      "bgi:n": "background-image:none;",
      "bgr": "background-repeat:|;",
      "bgr:n": "background-repeat:no-repeat;",
      "bgr:x": "background-repeat:repeat-x;",
      "bgr:y": "background-repeat:repeat-y;",
      "bgr:sp": "background-repeat:space;",
      "bgr:rd": "background-repeat:round;",
      "bga": "background-attachment:|;",
      "bga:f": "background-attachment:fixed;",
      "bga:s": "background-attachment:scroll;",
      "bgp": "background-position:${1:0} ${2:0};",
      "bgpx": "background-position-x:|;",
      "bgpy": "background-position-y:|;",
      "bgbk": "background-break:|;",
      "bgbk:bb": "background-break:bounding-box;",
      "bgbk:eb": "background-break:each-box;",
      "bgbk:c": "background-break:continuous;",
      "bgcp": "background-clip:${1:padding-box};",
      "bgcp:bb": "background-clip:border-box;",
      "bgcp:pb": "background-clip:padding-box;",
      "bgcp:cb": "background-clip:content-box;",
      "bgcp:nc": "background-clip:no-clip;",
      "bgo": "background-origin:|;",
      "bgo:pb": "background-origin:padding-box;",
      "bgo:bb": "background-origin:border-box;",
      "bgo:cb": "background-origin:content-box;",
      "bgsz": "background-size:|;",
      "bgsz:a": "background-size:auto;",
      "bgsz:ct": "background-size:contain;",
      "bgsz:cv": "background-size:cover;",
      "c": "color:#${1:000};",
      "c:r": "color:rgb(${1:0}, ${2:0}, ${3:0});",
      "c:ra": "color:rgba(${1:0}, ${2:0}, ${3:0}, .${4:5});",
      "cm": "/* |${child} */",
      "cnt": "content:'|';",
      "cnt:n": "content:normal;",
      "cnt:oq": "content:open-quote;",
      "cnt:noq": "content:no-open-quote;",
      "cnt:cq": "content:close-quote;",
      "cnt:ncq": "content:no-close-quote;",
      "cnt:a": "content:attr(|);",
      "cnt:c": "content:counter(|);",
      "cnt:cs": "content:counters(|);",


      "tbl": "table-layout:|;",
      "tbl:a": "table-layout:auto;",
      "tbl:f": "table-layout:fixed;",
      "cps": "caption-side:|;",
      "cps:t": "caption-side:top;",
      "cps:b": "caption-side:bottom;",
      "ec": "empty-cells:|;",
      "ec:s": "empty-cells:show;",
      "ec:h": "empty-cells:hide;",
      "lis": "list-style:|;",
      "lis:n": "list-style:none;",
      "lisp": "list-style-position:|;",
      "lisp:i": "list-style-position:inside;",
      "lisp:o": "list-style-position:outside;",
      "list": "list-style-type:|;",
      "list:n": "list-style-type:none;",
      "list:d": "list-style-type:disc;",
      "list:c": "list-style-type:circle;",
      "list:s": "list-style-type:square;",
      "list:dc": "list-style-type:decimal;",
      "list:dclz": "list-style-type:decimal-leading-zero;",
      "list:lr": "list-style-type:lower-roman;",
      "list:ur": "list-style-type:upper-roman;",
      "lisi": "list-style-image:|;",
      "lisi:n": "list-style-image:none;",
      "q": "quotes:|;",
      "q:n": "quotes:none;",
      "q:ru": "quotes:'\\00AB' '\\00BB' '\\201E' '\\201C';",
      "q:en": "quotes:'\\201C' '\\201D' '\\2018' '\\2019';",
      "ct": "content:|;",
      "ct:n": "content:normal;",
      "ct:oq": "content:open-quote;",
      "ct:noq": "content:no-open-quote;",
      "ct:cq": "content:close-quote;",
      "ct:ncq": "content:no-close-quote;",
      "ct:a": "content:attr(|);",
      "ct:c": "content:counter(|);",
      "ct:cs": "content:counters(|);",
      "coi": "counter-increment:|;",
      "cor": "counter-reset:|;",
      "va": "vertical-align:${1:top};",
      "va:sup": "vertical-align:super;",
      "va:t": "vertical-align:top;",
      "va:tt": "vertical-align:text-top;",
      "va:m": "vertical-align:middle;",
      "va:bl": "vertical-align:baseline;",
      "va:b": "vertical-align:bottom;",
      "va:tb": "vertical-align:text-bottom;",
      "va:sub": "vertical-align:sub;",
      "ta": "text-align:${1:left};",
      "ta:l": "text-align:left;",
      "ta:c": "text-align:center;",
      "ta:r": "text-align:right;",
      "ta:j": "text-align:justify;",
      "ta-lst": "text-align-last:|;",
      "tal:a": "text-align-last:auto;",
      "tal:l": "text-align-last:left;",
      "tal:c": "text-align-last:center;",
      "tal:r": "text-align-last:right;",
      "td": "text-decoration:${1:none};",
      "td:n": "text-decoration:none;",
      "td:u": "text-decoration:underline;",
      "td:o": "text-decoration:overline;",
      "td:l": "text-decoration:line-through;",
      "te": "text-emphasis:|;",
      "te:n": "text-emphasis:none;",
      "te:ac": "text-emphasis:accent;",
      "te:dt": "text-emphasis:dot;",
      "te:c": "text-emphasis:circle;",
      "te:ds": "text-emphasis:disc;",
      "te:b": "text-emphasis:before;",
      "te:a": "text-emphasis:after;",
      "th": "text-height:|;",
      "th:a": "text-height:auto;",
      "th:f": "text-height:font-size;",
      "th:t": "text-height:text-size;",
      "th:m": "text-height:max-size;",
      "ti": "text-indent:|;",
      "ti:-": "text-indent:-9999px;",
      "tj": "text-justify:|;",
      "tj:a": "text-justify:auto;",
      "tj:iw": "text-justify:inter-word;",
      "tj:ii": "text-justify:inter-ideograph;",
      "tj:ic": "text-justify:inter-cluster;",
      "tj:d": "text-justify:distribute;",
      "tj:k": "text-justify:kashida;",
      "tj:t": "text-justify:tibetan;",
      "tov": "text-overflow:${ellipsis};",
      "tov:e": "text-overflow:ellipsis;",
      "tov:c": "text-overflow:clip;",
      "to": "text-outline:|;",
      "to+": "text-outline:${1:0} ${2:0} ${3:#000};",
      "to:n": "text-outline:none;",
      "tr": "text-replace:|;",
      "tr:n": "text-replace:none;",
      "tt": "text-transform:${1:uppercase};",
      "tt:n": "text-transform:none;",
      "tt:c": "text-transform:capitalize;",
      "tt:u": "text-transform:uppercase;",
      "tt:l": "text-transform:lowercase;",
      "tw": "text-wrap:|;",
      "tw:n": "text-wrap:normal;",
      "tw:no": "text-wrap:none;",
      "tw:u": "text-wrap:unrestricted;",
      "tw:s": "text-wrap:suppress;",
      "tsh": "text-shadow:${1:hoff} ${2:voff} ${3:blur} ${4:#000};",
      "tsh:r": "text-shadow:${1:h} ${2:v} ${3:blur} rgb(${4:0}, ${5:0}, ${6:0});",
      "tsh:ra": "text-shadow:${1:h} ${2:v} ${3:blur} rgba(${4:0}, ${5:0}, ${6:0}, .${7:5});",
      "tsh+": "text-shadow:${1:0} ${2:0} ${3:0} ${4:#000};",
      "tsh:n": "text-shadow:none;",
      "trf": "transform:|;",
      "trf:skx": "transform: skewX(${1:angle});",
      "trf:sky": "transform: skewY(${1:angle});",
      "trf:sc": "transform: scale(${1:x}, ${2:y});",
      "trf:scx": "transform: scaleX(${1:x});",
      "trf:scy": "transform: scaleY(${1:y});",
      "trf:r": "transform: rotate(${1:angle});",
      "trf:t": "transform: translate(${1:x}, ${2:y});",
      "trf:tx": "transform: translateX(${1:x});",
      "trf:ty": "transform: translateY(${1:y});",
      "trfo": "transform-origin:|;",
      "trfs": "transform-style:${1:preserve-3d};",
      "trs": "transition:${1:prop} ${2:time};",
      "trsde": "transition-delay:${1:time};",
      "trsdu": "transition-duration:${1:time};",
      "trsp": "transition-property:${1:prop};",
      "trstf": "transition-timing-function:${1:tfunc};",
      "lh": "line-height:|;",
      "whs": "white-space:|;",
      "whs:n": "white-space:normal;",
      "whs:p": "white-space:pre;",
      "whs:nw": "white-space:nowrap;",
      "whs:pw": "white-space:pre-wrap;",
      "whs:pl": "white-space:pre-line;",
      "whsc": "white-space-collapse:|;",
      "whsc:n": "white-space-collapse:normal;",
      "whsc:k": "white-space-collapse:keep-all;",
      "whsc:l": "white-space-collapse:loose;",
      "whsc:bs": "white-space-collapse:break-strict;",
      "whsc:ba": "white-space-collapse:break-all;",
      "wob": "word-break:|;",
      "wob:n": "word-break:normal;",
      "wob:k": "word-break:keep-all;",
      "wob:l": "word-break:loose;",
      "wob:bs": "word-break:break-strict;",
      "wob:ba": "word-break:break-all;",
      "wos": "word-spacing:|;",
      "wow": "word-wrap:|;",
      "wow:nm": "word-wrap:normal;",
      "wow:n": "word-wrap:none;",
      "wow:u": "word-wrap:unrestricted;",
      "wow:s": "word-wrap:suppress;",
      "lts": "letter-spacing:|;",
      "f": "font:|;",
      "f+": "font:${1:1em} ${2:Arial,sans-serif};",
      "fw": "font-weight:|;",
      "fw:n": "font-weight:normal;",
      "fw:b": "font-weight:bold;",
      "fw:br": "font-weight:bolder;",
      "fw:lr": "font-weight:lighter;",
      "fs": "font-style:${italic};",
      "fs:n": "font-style:normal;",
      "fs:i": "font-style:italic;",
      "fs:o": "font-style:oblique;",
      "fv": "font-variant:|;",
      "fv:n": "font-variant:normal;",
      "fv:sc": "font-variant:small-caps;",
      "fz": "font-size:|;",
      "fza": "font-size-adjust:|;",
      "fza:n": "font-size-adjust:none;",
      "ff": "font-family:|;",
      "ff:s": "font-family:serif;",
      "ff:ss": "font-family:sans-serif;",
      "ff:c": "font-family:cursive;",
      "ff:f": "font-family:fantasy;",
      "ff:m": "font-family:monospace;",
      "fef": "font-effect:|;",
      "fef:n": "font-effect:none;",
      "fef:eg": "font-effect:engrave;",
      "fef:eb": "font-effect:emboss;",
      "fef:o": "font-effect:outline;",
      "fem": "font-emphasize:|;",
      "femp": "font-emphasize-position:|;",
      "femp:b": "font-emphasize-position:before;",
      "femp:a": "font-emphasize-position:after;",
      "fems": "font-emphasize-style:|;",
      "fems:n": "font-emphasize-style:none;",
      "fems:ac": "font-emphasize-style:accent;",
      "fems:dt": "font-emphasize-style:dot;",
      "fems:c": "font-emphasize-style:circle;",
      "fems:ds": "font-emphasize-style:disc;",
      "fsm": "font-smooth:|;",
      "fsm:a": "font-smooth:auto;",
      "fsm:n": "font-smooth:never;",
      "fsm:aw": "font-smooth:always;",
      "fst": "font-stretch:|;",
      "fst:n": "font-stretch:normal;",
      "fst:uc": "font-stretch:ultra-condensed;",
      "fst:ec": "font-stretch:extra-condensed;",
      "fst:c": "font-stretch:condensed;",
      "fst:sc": "font-stretch:semi-condensed;",
      "fst:se": "font-stretch:semi-expanded;",
      "fst:e": "font-stretch:expanded;",
      "fst:ee": "font-stretch:extra-expanded;",
      "fst:ue": "font-stretch:ultra-expanded;",
      "op": "opacity:|;",
      "op:ie": "filter:progid:DXImageTransform.Microsoft.Alpha(Opacity=100);",
      "op:ms": "-ms-filter:'progid:DXImageTransform.Microsoft.Alpha(Opacity=100)';",
      "rsz": "resize:|;",
      "rsz:n": "resize:none;",
      "rsz:b": "resize:both;",
      "rsz:h": "resize:horizontal;",
      "rsz:v": "resize:vertical;",
      "cur": "cursor:${pointer};",
      "cur:a": "cursor:auto;",
      "cur:d": "cursor:default;",
      "cur:c": "cursor:crosshair;",
      "cur:ha": "cursor:hand;",
      "cur:he": "cursor:help;",
      "cur:m": "cursor:move;",
      "cur:p": "cursor:pointer;",
      "cur:t": "cursor:text;",
      "pgbb": "page-break-before:|;",
      "pgbb:au": "page-break-before:auto;",
      "pgbb:al": "page-break-before:always;",
      "pgbb:l": "page-break-before:left;",
      "pgbb:r": "page-break-before:right;",
      "pgbi": "page-break-inside:|;",
      "pgbi:au": "page-break-inside:auto;",
      "pgbi:av": "page-break-inside:avoid;",
      "pgba": "page-break-after:|;",
      "pgba:au": "page-break-after:auto;",
      "pgba:al": "page-break-after:always;",
      "pgba:l": "page-break-after:left;",
      "pgba:r": "page-break-after:right;",
      "orp": "orphans:|;",
      "us": "user-select:${none};",
      "wid": "widows:|;",
      "wfsm": "-webkit-font-smoothing:${antialiased};",
      "wfsm:a": "-webkit-font-smoothing:antialiased;",
      "wfsm:s": "-webkit-font-smoothing:subpixel-antialiased;",
      "wfsm:sa": "-webkit-font-smoothing:subpixel-antialiased;",
      "wfsm:n": "-webkit-font-smoothing:none;"
    }
  },
  
  "html": {
    "filters": "html",
    "profile": "html",
    "snippets": {
      "!!!":    "<!doctype html>",
      "!!!4t":  "<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 4.01 Transitional//EN\" \"http://www.w3.org/TR/html4/loose.dtd\">",
      "!!!4s":  "<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 4.01//EN\" \"http://www.w3.org/TR/html4/strict.dtd\">",
      "!!!xt":  "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\">",
      "!!!xs":  "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Strict//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd\">",
      "!!!xxs": "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.1//EN\" \"http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd\">",

      "c": "<!-- |${child} -->",
      "cc:ie6": "<!--[if lte IE 6]>\n\t${child}|\n<![endif]-->",
      "cc:ie": "<!--[if IE]>\n\t${child}|\n<![endif]-->",
      "cc:noie": "<!--[if !IE]><!-->\n\t${child}|\n<!--<![endif]-->"
    },
    
    "abbreviations": {
      "!": "html:5",
      "a": "<a href=\"\">",
      "a:link": "<a href=\"http://|\">",
      "a:mail": "<a href=\"mailto:|\">",
      "abbr": "<abbr title=\"\">",
      "acronym": "<acronym title=\"\">",
      "base": "<base href=\"\" />",
      "bdo": "<bdo dir=\"\">",
      "bdo:r": "<bdo dir=\"rtl\">",
      "bdo:l": "<bdo dir=\"ltr\">",
      "link": "<link rel=\"stylesheet\" href=\"\" />",
      "link:css": "<link rel=\"stylesheet\" href=\"${1:style}.css\" media=\"all\" />",
      "link:print": "<link rel=\"stylesheet\" href=\"${1:print}.css\" media=\"print\" />",
      "link:favicon": "<link rel=\"shortcut icon\" type=\"image/x-icon\" href=\"${1:favicon.ico}\" />",
      "link:touch": "<link rel=\"apple-touch-icon\" href=\"${1:favicon.png}\" />",
      "link:rss": "<link rel=\"alternate\" type=\"application/rss+xml\" title=\"RSS\" href=\"${1:rss.xml}\" />",
      "link:atom": "<link rel=\"alternate\" type=\"application/atom+xml\" title=\"Atom\" href=\"${1:atom.xml}\" />",
      "meta:utf": "<meta http-equiv=\"Content-Type\" content=\"text/html;charset=UTF-8\" />",
      "meta:win": "<meta http-equiv=\"Content-Type\" content=\"text/html;charset=windows-1251\" />",
      "meta:vp": "<meta name=\"viewport\" content=\"width=${1:device-width}, user-scalable=${2:no}, initial-scale=${3:1.0}, maximum-scale=${4:1.0}, minimum-scale=${5:1.0}\" />",
      "meta:compat": "<meta http-equiv=\"X-UA-Compatible\" content=\"${1:IE=7}\" />",
      "style": "<style>",
      "script": "<script>",
      "script:src": "<script src=\"\">",
      "img": "<img src=\"\" alt=\"\" />",
      "iframe": "<iframe src=\"\" frameborder=\"0\">",
      "embed": "<embed src=\"\" type=\"\" />",
      "object": "<object data=\"\" type=\"\">",
      "param": "<param name=\"\" value=\"\" />",
      "map": "<map name=\"\">",
      "area": "<area shape=\"\" coords=\"\" href=\"\" alt=\"\" />",
      "area:d": "<area shape=\"default\" href=\"\" alt=\"\" />",
      "area:c": "<area shape=\"circle\" coords=\"\" href=\"\" alt=\"\" />",
      "area:r": "<area shape=\"rect\" coords=\"\" href=\"\" alt=\"\" />",
      "area:p": "<area shape=\"poly\" coords=\"\" href=\"\" alt=\"\" />",
      "form": "<form action=\"\">",
      "form:get": "<form action=\"\" method=\"get\">",
      "form:post": "<form action=\"\" method=\"post\">",
      "label": "<label for=\"\">",
      "input": "<input type=\"${1:text}\" />",
      "inp": "<input type=\"${1:text}\" name=\"\" id=\"\" />",
      "input:hidden": "input[type=hidden name]",
      "input:h": "input:hidden",
      "input:text": "inp",
      "input:t": "inp",
      "input:search": "inp[type=search]",
      "input:email": "inp[type=email]",
      "input:url": "inp[type=url]",
      "input:password": "inp[type=password]",
      "input:p": "input:password",
      "input:datetime": "inp[type=datetime]",
      "input:date": "inp[type=date]",
      "input:datetime-local": "inp[type=datetime-local]",
      "input:month": "inp[type=month]",
      "input:week": "inp[type=week]",
      "input:time": "inp[type=time]",
      "input:number": "inp[type=number]",
      "input:color": "inp[type=color]",
      "input:checkbox": "inp[type=checkbox]",
      "input:c": "input:checkbox",
      "input:radio": "inp[type=radio]",
      "input:r": "input:radio",
      "input:range": "inp[type=range]",
      "input:file": "inp[type=file]",
      "input:f": "input:file",
      "input:submit": "<input type=\"submit\" value=\"\" />",
      "input:s": "input:submit",
      "input:image": "<input type=\"image\" src=\"\" alt=\"\" />",
      "input:i": "input:image",
      "input:button": "<input type=\"button\" value=\"\" />",
      "input:b": "input:button",
      "input:reset": "input:button[type=reset]",
      "select": "<select name=\"\" id=\"\">",
      "option": "<option value=\"\">",
      "textarea": "<textarea name=\"\" id=\"\" cols=\"${1:30}\" rows=\"${2:10}\">",
      "menu:context": "menu[type=context]>",
      "menu:c": "menu:context",
      "menu:toolbar": "menu[type=toolbar]>",
      "menu:t": "menu:toolbar",
      "video": "<video src=\"\">",
      "audio": "<audio src=\"\">",
      "html:xml": "<html xmlns=\"http://www.w3.org/1999/xhtml\">",
      
      "bq": "blockquote",
      "acr": "acronym",
      "fig": "figure",
      "figc": "figcaption",
      "ifr": "iframe",
      "emb": "embed",
      "obj": "object",
      "src": "source",
      "cap": "caption",
      "colg": "colgroup",
      "fst": "fieldset",
      "btn": "button",
      "optg": "optgroup",
      "opt": "option",
      "tarea": "textarea",
      "leg": "legend",
      "sect": "section",
      "art": "article",
      "hdr": "header",
      "ftr": "footer",
      "adr": "address",
      "dlg": "dialog",
      "str": "strong",
      "prog": "progress",
      "fset": "fieldset",
      "datag": "datagrid",
      "datal": "datalist",
      "kg": "keygen",
      "out": "output",
      "det": "details",
      "cmd": "command",
      "doc": "html>(head>meta[charset=UTF-8]+title{${1:Document}})+body",
      "doc4": "html>(head>meta[http-equiv=\"Content-Type\" content=\"text/html;charset=${charset}\"]+title{${1:Document}})",

      "html:4t":  "!!!4t+doc4[lang=${lang}]",
      "html:4s":  "!!!4s+doc4[lang=${lang}]",
      "html:xt":  "!!!xt+doc4[xmlns=http://www.w3.org/1999/xhtml xml:lang=${lang}]",
      "html:xs":  "!!!xs+doc4[xmlns=http://www.w3.org/1999/xhtml xml:lang=${lang}]",
      "html:xxs": "!!!xxs+doc4[xmlns=http://www.w3.org/1999/xhtml xml:lang=${lang}]",
      "html:5":   "!!!+doc[lang=${lang}]",
      
      "ol+": "ol>li",
      "ul+": "ul>li",
      "dl+": "dl>dt+dd",
      "map+": "map>area",
      "table+": "table>tr>td",
      "colgroup+": "colgroup>col",
      "colg+": "colgroup>col",
      "tr+": "tr>td",
      "select+": "select>option",
      "optgroup+": "optgroup>option",
      "optg+": "optgroup>option"
    }
  },
  
  "xml": {
    "extends": "html",
    "profile": "xml",
    "filters": "html"
  },
  
  "xsl": {
    "extends": "html",
    "profile": "xml",
    "filters": "html, xsl",
    "abbreviations": {
      "tm": "<xsl:template match=\"\" mode=\"\">",
      "tmatch": "tm",
      "tn": "<xsl:template name=\"\">",
      "tname": "tn",
      "call": "<xsl:call-template name=\"\"/>",
      "ap": "<xsl:apply-templates select=\"\" mode=\"\"/>",
      "api": "<xsl:apply-imports/>",
      "imp": "<xsl:import href=\"\"/>",
      "inc": "<xsl:include href=\"\"/>",

      "ch": "<xsl:choose>",
      "xsl:when": "<xsl:when test=\"\">",
      "wh": "xsl:when",
      "ot": "<xsl:otherwise>",
      "if": "<xsl:if test=\"\">",

      "par": "<xsl:param name=\"\">",
      "pare": "<xsl:param name=\"\" select=\"\"/>",
      "var": "<xsl:variable name=\"\">",
      "vare": "<xsl:variable name=\"\" select=\"\"/>",
      "wp": "<xsl:with-param name=\"\" select=\"\"/>",
      "key": "<xsl:key name=\"\" match=\"\" use=\"\"/>",

      "elem": "<xsl:element name=\"\">",
      "attr": "<xsl:attribute name=\"\">",
      "attrs": "<xsl:attribute-set name=\"\">",

      "cp": "<xsl:copy select=\"\"/>",
      "co": "<xsl:copy-of select=\"\"/>",
      "val": "<xsl:value-of select=\"\"/>",
      "each": "<xsl:for-each select=\"\">",
      "for": "each",
      "tex": "<xsl:text></xsl:text>",

      "com": "<xsl:comment>",
      "msg": "<xsl:message terminate=\"no\">",
      "fall": "<xsl:fallback>",
      "num": "<xsl:number value=\"\"/>",
      "nam": "<namespace-alias stylesheet-prefix=\"\" result-prefix=\"\"/>",
      "pres": "<xsl:preserve-space elements=\"\"/>",
      "strip": "<xsl:strip-space elements=\"\"/>",
      "proc": "<xsl:processing-instruction name=\"\">",
      "sort": "<xsl:sort select=\"\" order=\"\"/>",

      "choose+": "xsl:choose>xsl:when+xsl:otherwise",
      "xsl": "!!!+xsl:stylesheet[version=1.0 xmlns:xsl=http://www.w3.org/1999/XSL/Transform]>{\n|}"
    }, 
    "snippets": {
      "!!!": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
    }
  },
  
  "haml": {
    "filters": "haml",
    "extends": "html",
    "profile": "xml"
  },
  
  "scss": {
    "extends": "css"
  },
  
  "sass": {
    "extends": "css"
  },
  
  "less": {
    "extends": "css"
  },
  
  "stylus": {
    "extends": "css"
  }
}
, 'system');});/**
 * Implementation of {@link IEmmetEditor} interface for CodeMirror2
 * @param {Function} require
 * @param {Underscore} _
 */
emmet.define('cm-editor-proxy', function(require, _) {
  var ios = /AppleWebKit/.test(navigator.userAgent) && /Mobile\/\w+/.test(navigator.userAgent);
  var mac = ios || /Mac/.test(navigator.platform);
  var keymap = {
    'Cmd-E': 'expand_abbreviation',
    'Tab': 'expand_abbreviation_with_tab',
    'Cmd-D': 'match_pair_outward',
    'Shift-Cmd-D': 'match_pair_inward',
    'Cmd-T': 'matching_pair',
    'Shift-Cmd-A': 'wrap_with_abbreviation',
    'Ctrl-Alt-Right': 'next_edit_point',
    'Ctrl-Alt-Left': 'prev_edit_point',
    'Cmd-L': 'select_line',
    'Cmd-Shift-M': 'merge_lines',
    'Cmd-/': 'toggle_comment',
    'Cmd-J': 'split_join_tag',
    'Cmd-K': 'remove_tag',
    'Shift-Cmd-Y': 'evaluate_math_expression',

    'Ctrl-Up': 'increment_number_by_1',
    'Ctrl-Down': 'decrement_number_by_1',
    'Alt-Up': 'increment_number_by_01',
    'Alt-Down': 'decrement_number_by_01',
    'Ctrl-Alt-Up': 'increment_number_by_10',
    'Ctrl-Alt-Down': 'decrement_number_by_10',

    'Shift-Cmd-.': 'select_next_item',
    'Shift-Cmd-,': 'select_previous_item',
    'Cmd-B': 'reflect_css_value',
    
    'Enter': 'insert_formatted_line_break_only'
  };
  
  var modeMap = {
    'text/html': 'html',
    'application/xml': 'xml',
    'text/xsl': 'xsl',
    'text/css': 'css',
    'text/x-less': 'less'
  };
  
  // add “profile” property to CodeMirror defaults so in won’t be lost
  // then CM instance is instantiated with “profile” property
  if (CodeMirror.defineOption) {
    CodeMirror.defineOption('profile', 'html');
  } else {
    CodeMirror.defaults.profile = 'html';
  }
  
  var editorProxy = {
    context: null,

    getSelectionRange: function() {
      var caretPos = this.getCaretPos();
      return {
        start: caretPos,
        end: caretPos + this.getSelection().length
      };
    },

    createSelection: function(start, end) {
      if (start == end) {
        this.context.setCursor(this.context.posFromIndex(start));
      } else {
        this.context.setSelection(this.context.posFromIndex(start), this.context.posFromIndex(end));
      }
    },

    getCurrentLineRange: function() {
      var caret = this.context.getCursor(true);
      return {
        start: this.context.indexFromPos({line: caret.line, ch: 0}),
        end:   this.context.indexFromPos({line: caret.line, ch: this.context.getLine(caret.line).length})
      };
    },

    getCaretPos: function(){
      return this.context.indexFromPos(this.context.getCursor(true));
    },

    setCaretPos: function(pos){
      this.createSelection(pos, pos);
    },

    getCurrentLine: function() {
      return this.context.getLine( this.context.getCursor(true).line ) || '';
    },

    replaceContent: function(value, start, end, noIndent) {
      
      if (_.isUndefined(end)) 
        end = _.isUndefined(start) ? content.length : start;
      if (_.isUndefined(start)) start = 0;
      var utils = require('utils');
      
      // indent new value
      if (!noIndent) {
        value = utils.padString(value, utils.getLinePaddingFromPosition(this.getContent(), start));
      }
      
      // find new caret position
      var tabstopData = require('tabStops').extract(value, {
        escape: function(ch) {
          return ch;
        }
      });
      value = tabstopData.text;
      var firstTabStop = tabstopData.tabstops[0];
      
      if (firstTabStop) {
        firstTabStop.start += start;
        firstTabStop.end += start;
      } else {
        firstTabStop = {
          start: value.length + start,
          end: value.length + start
        };
      }
        
      // do a compound change to record all changes into single undo event
      var that = this;
      var op = this.context.operation || this.context.compoundChange;
      op.call(this.context, function() {
        that.context.replaceRange(value, that.context.posFromIndex(start), that.context.posFromIndex(end));
        that.createSelection(firstTabStop.start, firstTabStop.end);
      });
    },

    getContent: function(){
      return this.context.getValue();
    },

    getSyntax: function() {
      var syntax = this.context.getOption('mode');
      if (syntax in modeMap) {
        syntax = modeMap[syntax];
      }
      
      return require('actionUtils').detectSyntax(this, syntax);
    },

    /**
     * Returns current output profile name (@see emmet#setupProfile)
     * @return {String}
     */
    getProfileName: function() {
      if (this.context.getOption('profile'))
        return this.context.getOption('profile');
      
      return require('actionUtils').detectProfile(this);
    },

    /**
     * Ask user to enter something
     * @param {String} title Dialog title
     * @return {String} Entered data
     * @since 0.65
     */
    prompt: function(title) {
      return prompt(title);
    },

    /**
     * Returns current selection
     * @return {String}
     * @since 0.65
     */
    getSelection: function() {
      return this.context.getSelection() || '';
    },

    /**
     * Returns current editor's file path
     * @return {String}
     * @since 0.65 
     */
    getFilePath: function() {
      return location.href;
    },

    setupContext: function(ctx) {
      this.context = ctx;
      var indentation = '\t';
      if (!ctx.getOption('indentWithTabs')) {
        indentation = require('utils').repeatString(' ', ctx.getOption('indentUnit'));
      }
      
      require('resources').setVariable('indentation', indentation);
    },

    addAction: function(commandName, keybinding, target) {
      // register Emmet command as predefined CodeMirror command
      // for latter use
      var cmCommand = 'emmet.' + commandName;
      if (!CodeMirror.commands[cmCommand]) {
        CodeMirror.commands[cmCommand] = function(editor) {
          return runEmmetCommand(commandName, editor);
        };
      }

      if (keybinding) {
        if (!target) {
          // check out CM3 keymap style
          if (CodeMirror.keyMap && CodeMirror.keyMap['default']) {
            target = CodeMirror.keyMap['default'];
          } else {
            if (!CodeMirror.defaults.extraKeys) {
              CodeMirror.defaults.extraKeys = {};
            }

            target = CodeMirror.defaults.extraKeys;
          }
        }

        if (!mac) {
          keybinding = keybinding.replace('Cmd', 'Ctrl');
        }

        if (target) {
          target[keybinding] = cmCommand;
        }
      }     
    }
  };
  
  function isValidSyntax() {
    var syntax = editorProxy.getSyntax();
    return require('resources').hasSyntax(syntax);
  }
  
  function noop() {
    if (CodeMirror.version >= '3.1') {
      return CodeMirror.Pass;
    }
    
    throw CodeMirror.Pass;
  }
  
  function runEmmetCommand(name, editor) {
    editorProxy.setupContext(editor);
    if (name == 'expand_abbreviation_with_tab' && (editorProxy.getSelection() || !isValidSyntax())) {
      // pass through Tab key handler if there's a selection
      return noop();
    }
    
    var success = true;
    
    try {
      var result = require('actions').run(name, editorProxy);
      // a bit weird fix for the following action (actually, for their
      // keybindings) to prevent CM2 from inserting block characters
      if (name == 'next_edit_point' || name == 'prev_edit_point') {
        editor.replaceSelection('');
      }
      
      if (!result && name == 'insert_formatted_line_break_only') {
        success = false;
      }
    } catch (e) {}
    
    if (!success) {
      return noop();
    }
  }
  
  // add keybindings to CodeMirror
  if (typeof emmetKeymap != 'undefined') {
    keymap = emmetKeymap;
  }
  
  _.each(keymap, function(commandName, keybinding) {
    keymap, editorProxy.addAction(commandName, keybinding);
  });

  return editorProxy;
});
