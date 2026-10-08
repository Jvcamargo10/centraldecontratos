/* A data de hoje no fuso local, não em UTC (29/09/2026): em Itaverde
   (UTC−3), das 21h à meia-noite o `toISOString()` já dava o dia seguinte. */
const { test } = require('node:test');
const assert = require('node:assert');
const { hojeLocal } = require('../integrations/dataLocal');

test('hojeLocal usa o dia local, mesmo quando em UTC já é o dia seguinte', () => {
  const noite = new Date(2026, 8, 28, 22, 30); // 28/09 às 22h30, hora local
  assert.strictEqual(hojeLocal(noite), '2026-09-28');
});

test('carimbo com hora vira o dia local; data pura volta como está', () => {
  const carimbo = new Date(2026, 8, 28, 23, 10).toISOString();
  assert.strictEqual(hojeLocal(carimbo), '2026-09-28');
  assert.strictEqual(hojeLocal('2026-09-28'), '2026-09-28');
});
