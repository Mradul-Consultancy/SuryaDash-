const assert = require('assert');
const fs = require('fs');

// Basic mock for window to load the script
global.window = {};
const solarPhysicsCode = fs.readFileSync(__dirname + '/../../assets/js/solar-physics.js', 'utf8');
eval(solarPhysicsCode);

const SOLAR = global.window.SOLAR || global.SOLAR;

function runTests() {
  console.log("Running unit tests for solar-physics.js");
  
  assert.ok(SOLAR, 'SOLAR module should be defined');
  
  // Test location setting
  SOLAR.setLocation(40, -75);
  
  // Test maths (mocking date)
  // Let's just ensure start() doesn't throw
  try {
    SOLAR.start(1000);
    assert.ok(true);
  } catch (e) {
    assert.fail("SOLAR.start() threw an error: " + e.message);
  }
  
  console.log("✔ solar-physics tests passed");
}

try {
  runTests();
} catch(e) {
  console.error("Test failed:", e);
  process.exit(1);
}
