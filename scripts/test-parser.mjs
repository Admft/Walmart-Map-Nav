import {
  extractMapData,
  mapDataToModel,
  parseSearchQuery,
  aislePointsFor,
  sideInfoForAisle,
  buildAisleIndex,
} from '../public/map-parser.js';
import fs from 'fs';

const html = fs.readFileSync('stores/1216.html', 'utf8');
const model = mapDataToModel(extractMapData(html));
const index = buildAisleIndex(model.points);

const aisleQuery = parseSearchQuery('A13');
const exactQuery = parseSearchQuery('A13.5');
const a13pts = aislePointsFor(model.points, 'A13');
const side = sideInfoForAisle('A13', index);

console.log('points', model.points.length);
console.log('aisle query', aisleQuery);
console.log('exact query', exactQuery);
console.log('A13 markers', a13pts.length);
console.log('A13.5 exists', model.byId.has('A13.5'));
console.log('side info', side);

if (aisleQuery.mode !== 'aisle' || a13pts.length < 10) process.exit(1);
if (exactQuery.mode !== 'exact' || !model.byId.has('A13.5')) process.exit(1);
console.log('ok');
