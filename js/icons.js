/* icons.js — 지형 아이콘 (헥스맵 문서의 심볼을 그대로 재사용)
 * F 식량(밀) / W 목재(나무) / I 철(광석) / M 마석(결정) / S 본진 / C 중앙 공용 광맥
 */
window.ICONS = [
  '<defs>',
  '<symbol id="i-F" viewBox="0 0 24 24"><path d="M12 23V7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/><g fill="currentColor"><ellipse cx="12" cy="4.2" rx="1.6" ry="3"/><ellipse cx="9.4" cy="9" rx="1.6" ry="3" transform="rotate(-32 9.4 9)"/><ellipse cx="14.6" cy="9" rx="1.6" ry="3" transform="rotate(32 14.6 9)"/><ellipse cx="9.4" cy="13.6" rx="1.6" ry="3" transform="rotate(-32 9.4 13.6)"/><ellipse cx="14.6" cy="13.6" rx="1.6" ry="3" transform="rotate(32 14.6 13.6)"/><ellipse cx="9.4" cy="18.2" rx="1.6" ry="3" transform="rotate(-32 9.4 18.2)"/><ellipse cx="14.6" cy="18.2" rx="1.6" ry="3" transform="rotate(32 14.6 18.2)"/></g></symbol>',
  '<symbol id="i-W" viewBox="0 0 24 24"><path fill="currentColor" d="M12 1.5 6.2 9.2h3.3L4.8 15.4h4.1L4 21h16l-4.9-5.6h4.1l-4.7-6.2h3.3Z"/><rect x="10.6" y="20" width="2.8" height="3.5" fill="currentColor"/></symbol>',
  '<symbol id="i-I" viewBox="0 0 24 24"><g fill="currentColor"><path d="M6.3 13.6 8.6 7.4h6.8l2.3 6.2Z"/><path d="M1.5 21.5 3.8 15.2h6.8l2.3 6.3Z"/><path d="M11.1 21.5l2.3-6.3h6.8l2.3 6.3Z"/></g><path class="facet" d="M8.6 7.4 9.6 10h4.8l1-2.6M3.8 15.2l1 2.6h4.8l1-2.6M13.4 15.2l1 2.6h4.8l1-2.6"/></symbol>',
  '<symbol id="i-M" viewBox="0 0 24 24"><path fill="currentColor" d="M12 1.5 19.5 8.5 12 22.5 4.5 8.5Z"/><path class="facet" d="M4.5 8.5h15M12 1.5 9 8.5l3 14 3-14Z"/></symbol>',
  '<symbol id="i-S" viewBox="0 0 24 24"><path fill="currentColor" d="M3 22.5V9.5h3.4v3h2.8v-3h5.6v3h2.8v-3H21v13h-6.3v-5.2a2.7 2.7 0 0 0-5.4 0v5.2Z"/><path d="M12 9.5V1.5" stroke="currentColor" stroke-width="1.5"/><path fill="currentColor" d="M12.6 1.8h5.6l-1.6 1.9 1.6 1.9h-5.6Z"/></symbol>',
  '<symbol id="i-C" viewBox="0 0 24 24"><g fill="currentColor"><path d="M12 .8 16.4 7 12 21.5 7.6 7Z"/><path d="M5.2 8.5 8.2 12.4 6.4 21.5 3 14.8 3.6 11Z"/><path d="M18.8 8.5 15.8 12.4 17.6 21.5 21 14.8 20.4 11Z"/></g><path class="facet" d="M7.6 7h8.8M12 .8 10.4 7 12 21.5 13.6 7Z"/></symbol>',
  '</defs>',
].join('');
