const state = {
    drivers: {
        "1": { number: "1", name: "MAG" }
    }
};

let queuedUpdates = [];
function setDrivers(updater) {
    queuedUpdates.push(updater);
}

// 1. Position Update
const posData = { Cars: { "1": { X: 100, Y: 200, Z: 300 } } };
setDrivers(prev => {
  const next = { ...prev };
  Object.keys(posData.Cars).forEach(key => {
    const car = posData.Cars[key];
    const driverNum = car.DriverNumber || key;
    const x = car.X, y = car.Y, z = car.Z;
    if (!next[driverNum]) next[driverNum] = { number: driverNum };
    
    // Zde je klíčový detail z LiveVisualizer.jsx
    next[driverNum] = { ...next[driverNum] }; // DODATEK PRO DEEP CLONE ?? (Ne, v LiveVisualizer.jsx je přímo mutace)
    
    // Oh, počkat! V LiveVisualizer.jsx to bylo původně: 
    // next[driverNum] = { ...next[driverNum], number: driverNum };
    // A TEĎ tam je:
    // if (!next[driverNum]) next[driverNum] = { number: driverNum };
    // next[driverNum].x = x;
  });
  return next;
});

// Run updates
let currentState = state.drivers;
for (let u of queuedUpdates) {
    currentState = u(currentState);
}
console.log(currentState);
