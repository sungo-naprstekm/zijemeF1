const fs = require('fs');

const dataStr = '{"category":"Position","data":{"Cars":{"1":{"X":4601.8,"Y":-896.2,"Z":2006.2},"11":{"X":4327.3,"Y":-371.3,"Z":3154.5}}},"timestamp":1715694380.123}';
const msg = JSON.parse(dataStr);
const { category, data } = msg;

let carsData = null;
if (data?.Cars) {
    carsData = data.Cars;
}
console.log('carsData keys:', Object.keys(carsData));
Object.keys(carsData).forEach(key => {
    const car = carsData[key];
    const driverNum = car.DriverNumber || key;
    const x = car.X !== undefined ? car.X : car.Channels?.['0'];
    console.log(`Driver ${driverNum}: x=${x}`);
});
