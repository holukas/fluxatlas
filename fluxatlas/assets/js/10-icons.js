  /* ------------------------------------------------------------------------------------------
     Icons
     ------------------------------------------------------------------------------------------
     Drawn rather than fetched, and named by the badge registry in Python, which asserts that every
     badge's icon exists here - a badge whose icon is missing would render as an empty box.
     Keep the four-space indentation of the keys: the build reads them from this file.
     ------------------------------------------------------------------------------------------ */

  const ICONS = {
    'flame': '<path d="M12 3c3.2 4 5 5.8 5 8.9A5 5 0 0 1 7 12c0-1.7.6-3 1.6-4.2C9.6 9.3 11.2 6.2 12 3z"/>',
    'flames': '<path d="M9.5 3c2.4 3 3.8 4.4 3.8 6.7a3.8 3.8 0 0 1-7.6 0c0-1.3.5-2.3 1.2-3.2.8 1.1 2 .4 2.6-3.5z"/><path d="M17 10.5c1.4 1.9 2.3 2.6 2.3 4a2.3 2.3 0 0 1-4.6 0c0-.8.3-1.4.7-1.9.5.7 1.2.2 1.6-2.1z"/>',
    'snowflake': '<path d="M12 2v20M4.2 7l15.6 10M19.8 7L4.2 17M12 6l-2.4-2.4M12 6l2.4-2.4M12 18l-2.4 2.4M12 18l2.4 2.4"/>',
    'icicles': '<path d="M3 5h18M7 5v5l1.4 4.5L9.8 10V5M14 5v7l1.4 5 1.4-5V5"/>',
    'moon': '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
    'droplets': '<path d="M8.4 2.5s3.9 4.2 3.9 6.5a3.9 3.9 0 1 1-7.8 0c0-2.3 3.9-6.5 3.9-6.5z"/><path d="M16.2 11.2s3.2 3.5 3.2 5.4a3.2 3.2 0 1 1-6.4 0c0-1.9 3.2-5.4 3.2-5.4z"/>',
    'droplet-off': '<path d="M12 3.2s5.2 5.6 5.2 8.8a5.2 5.2 0 0 1-10.4 0C6.8 8.8 12 3.2 12 3.2z"/><path d="M3.5 3.5l17 17"/>',
    'cloud-rain': '<path d="M17.5 16H9a6 6 0 1 1 5.7-7.8h2.8a4 4 0 1 1 0 7.8z"/><path d="M8.5 19v2.5M12 19v3M15.5 19v2.5"/>',
    'calendar-dry': '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18M8.5 15.5h7"/>',
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/>',
    'cloud': '<path d="M17.5 19H9a6.5 6.5 0 1 1 6.2-8.5h2.3a4.25 4.25 0 1 1 0 8.5z"/>',
    'gauge': '<path d="M3.6 18.5a10 10 0 1 1 16.8 0"/><path d="M12 14.5l4.2-4.7"/><circle cx="12" cy="15.5" r="1.6"/>',
    'soil': '<path d="M3.5 11h17v9.5h-17z"/><path d="M12 11V6.5"/><path d="M12 8.5c-2.2 0-3.4-1.2-3.4-3 1.9 0 3.4 1.2 3.4 3zM12 8.5c2.2 0 3.4-1.2 3.4-3-1.9 0-3.4 1.2-3.4 3z"/>',
    'award': '<circle cx="12" cy="8.5" r="5.6"/><path d="M15.4 13.4 17 22l-5-2.9L7 22l1.6-8.6"/>',
    'arrow-up': '<path d="M12 20V4M5 11l7-7 7 7"/>',
    'arrow-down': '<path d="M12 4v16M19 13l-7 7-7-7"/>',
    'alert': '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.2M12 17.4h.01"/>',
    'sprout': '<path d="M7 20.5h10"/><path d="M12 20.5c0-5 0-7 0-9"/><path d="M12 11.5c-2.6 0-4.2-1.4-4.8-4.2 2.8-.3 4.6.9 4.8 4.2zM12 11.5c2.6 0 4.2-1.9 4.8-5.2-2.8.3-4.6 1.9-4.8 5.2z"/>',
    'leaf-fall': '<path d="M11.5 19.5A6.5 6.5 0 0 1 10.4 6.6C15.7 5.5 17.1 5 19 2.7c.9 1.9 1.8 3.9 1.8 7.4 0 5.1-4.4 9.4-9.3 9.4z"/><path d="M2.5 21.5c0-2.8 1.7-5 4.7-5.6 2.2-.4 4.5-1.9 5.4-2.9"/>',
    'star': '<path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5-4.7-4.6 6.5-.9z"/>',
    'snow-cloud': '<path d="M17.5 15.5H9a6 6 0 1 1 5.7-7.8h2.8a4 4 0 1 1 0 7.8z"/><path d="M8.5 18.5v2.4M7.3 19.1l2.4 1.2M9.7 19.1l-2.4 1.2M15.5 18.5v2.4M14.3 19.1l2.4 1.2M16.7 19.1l-2.4 1.2"/>',
    'thermo-swing': '<path d="M12 3.2v17.6"/><path d="m7.5 7.7 4.5-4.5 4.5 4.5"/><path d="m7.5 16.3 4.5 4.5 4.5-4.5"/>',
    'fog': '<path d="M3 7.5h18M6 11.5h13M3.5 15.5h14M8 19.5h11"/>',
    'gauge-low': '<path d="M3.6 18.5a10 10 0 1 1 16.8 0"/><path d="M12 14.5 7.9 9.7"/><circle cx="12" cy="15.5" r="1.6"/>',
    'evaporation': '<path d="M2.8 20.5h18.4"/><path d="M7 17V8.5M7 8.5 5.2 10.6M7 8.5l1.8 2.1M12 17V4.6M12 4.6l-1.8 2.1M12 4.6l1.8 2.1M17 17V9.8M17 9.8l-1.8 2.1M17 9.8l1.8 2.1"/>',
    'droplet-low': '<path d="M12 3.1s5.3 5.7 5.3 8.9a5.3 5.3 0 0 1-10.6 0C6.7 8.8 12 3.1 12 3.1z"/><path d="M7.1 14.6h9.8"/>',
    'drought': '<circle cx="12" cy="6.4" r="3.1"/><path d="M12 1.3v1.3M7.6 6.4H6.3M17.7 6.4h-1.3M8.9 3.3 8 2.4M15.1 3.3l.9-.9"/><path d="M2.6 14.5h18.8"/><path d="M8.2 14.5v6.9M8.2 17.4l-2.3 1.5M15.8 14.5v6.9M15.8 18.1l2.3 1.3"/>'
  };

  function glyph(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + (ICONS[name] || '') + '</svg>';
  }

  /** A badge as a solid chip: the family in the background, the badge in the symbol. */
  function chip(key, size) {
    const b = BADGES[key];
    if (!b) return '';
    return '<span class="chip chip-' + b.tone + (size ? ' ' + size : '') + '" role="img" '
      + 'aria-label="' + b.label + '">' + glyph(b.icon) + '</span>';
  }

  /** The same chip for a day mark, which has no badge entry of its own. */
  function markChip(mark, size) {
    return '<span class="chip chip-' + mark.tone + (size ? ' ' + size : '') + '" role="img" '
      + 'aria-label="' + mark.label + '">' + glyph(mark.icon) + '</span>';
  }

