import assert from 'node:assert/strict';
import process from 'node:process';
import registerVisualQa from './index.js';

let command;
let request;
registerVisualQa({
  registerCommand(name, spec) {
    assert.equal(name, 'ui-qa');
    command = spec;
  },
  sendMessage(message, options) {
    request = { message, options };
  },
});
assert.ok(command);
const notifications = [];
await command.handler('', { ui: { notify: (text) => notifications.push(text) } });
assert.equal(request, undefined);
assert.equal(notifications.length, 1);
await command.handler('experiments/visual-qa/suite.json', { ui: { notify() {} } });
assert.equal(request.message.customType, 'visual-qa-run');
assert.equal(request.options.triggerTurn, true);
assert.match(request.message.content, /suite\.json/);
process.stdout.write('OMP command registration smoke passed\n');
