import test from 'node:test';
import assert from 'node:assert/strict';
import { detectShipmentText, resolveShipmentGroup } from '../shared/shipment-detection.mjs';
import { standardPath, uniqueOutputName, isChatTranscript } from '../shared/container.mjs';
import { similarPhotos, suggestLoadingPhotos } from '../shared/loading-photos.mjs';
import { sealRegions } from '../shared/photo-regions.mjs';

const record = (text, path = 'photo.jpg') => ({ path, evidence: detectShipmentText(text) });
test('reads chat identifiers, weight tickets, and typed shipping documents', () => {
  const found = detectShipmentText('[15/10/26, 13:00] Person: Container CSQU 305438-3\nSeal No: ABC1234567');
  assert.equal(found.containers[0].id, 'CSQU3054383');
  assert.equal(found.seals[0].id, 'ABC1234567');
  // Seals are stamped with the owner prefix split from the serial, and sit next to other text.
  for (const [text, id] of [['SEAL NO ML 0098812', 'ML0098812'], ['SEAL: ML-US 1234567', 'MLUS1234567'],
    ['SEAL NO. ML0098812', 'ML0098812'], ['SEAL NO 0098812 GROSS 32450 KG', '0098812'], ['SEAL 445566', '445566']]) {
    assert.deepEqual(detectShipmentText(text).seals.map(value => value.id), [id], text);
  }
  for (const text of ['SEALED CARTONS 20', 'SEAL NO: AB', 'SEAL NO: ML']) {
    assert.deepEqual(detectShipmentText(text).seals.filter(value => value.explicit), [], text);
  }
  assert.equal(detectShipmentText('INVOICE 5673 TICKET ID 42436 NET WEIGHT 21990 KG').category, 'weight');
  assert.equal(detectShipmentText('MAX GROSS 32500 TARE 3750 NET 28750').category, null);
  for (const [text, type] of [['Container Placement Order','CONTAINER_PLACEMENT_ORDER'], ['Terminal Handling Operation','TERMINAL_HANDLING'], ['Booking Confirmation','BOOKING_CONFIRMATION'], ['Empty Release Order','CONTAINER_RELEASE_ORDER'], ['Bill of Lading','BILL_OF_LADING'], ['Equipment Interchange Receipt','EIR']]) {
    const doc = detectShipmentText(text + '\nSRO2601593');
    assert.equal(doc.category, 'shipping'); assert.equal(doc.documentType, type); assert.equal(doc.seals.length, 0);
  }
  assert.equal(detectShipmentText('KIMTU9344936').containers[0].id, 'KMTU9344936');
  assert.equal(isChatTranscript('folder/WhatsApp Chat with Shipping.txt'), true);
});

test('shares only unambiguous shipment evidence, without leaking across imports', () => {
  const result = resolveShipmentGroup([record('CSQU3054383'), record('ABC1234567'), record('ABC1234567'), record('')]);
  assert.ok(result.every(item => item.container?.id === 'CSQU3054383'));
  assert.equal(result[3].seal, 'ABC1234567');
  assert.equal(resolveShipmentGroup([record('')])[0].container, null);
  assert.equal(resolveShipmentGroup([record('ABC1234567'), record('')])[1].seal, '');
  const conflict = resolveShipmentGroup([record('CSQU3054383'), record('KMTU9344936'), record('')]);
  assert.equal(conflict[2].container, null); assert.match(conflict[2].review, /Multiple/);
  const bad = resolveShipmentGroup([record('CSQU3054384'), record('')]);
  assert.equal(bad[1].container, null); assert.match(bad[0].review, /check digit/);
});

test('outputs flat collision-safe names with seal, stage and shipping document type', () => {
  assert.equal(standardPath('KMTU9344936','photos',1,4,'jpg','x.jpg',true,'SADMM2600430',25),'KMTU9344936_SEAL-SADMM2600430_LOADING_25PCT_01.jpg');
  assert.match(standardPath('CSQU3054383','shipping',1,1,'pdf','x.pdf',true,'','', 'BILL_OF_LADING'), /_BILL_OF_LADING_01.pdf$/);
  const used = new Set(); assert.equal(uniqueOutputName('IMG.jpg',used),'IMG.jpg'); assert.equal(uniqueOutputName('img.JPG',used),'img_2.JPG');
});

const fingerprint = n => ({ hash: Array(64).fill(n), colors: Array(216).fill(n * 30), aspect: .75 });
test('keeps four distinct photos per visible stage, with missing and uncertain evidence protected', () => {
  const stages = [0,25,50,75,100];
  const photos = stages.flatMap(stage => Array.from({length:6}, (_,i) => ({
    id: stage*10+i, kind:'image', category:'photos', path:`${stage}-${i}.jpg`,
    fingerprint:fingerprint(stage+i), ai:{stage,quality:1-i/10},
  })));
  photos.push({...photos[0],id:9000,path:'copy.jpg',ai:{stage:0,quality:.99}});
  const protectedItems = ['videos','seals','closed','weight','shipping','invoices','documents'].map((category,i)=>({id:10000+i,kind:category==='videos'?'video':'image',category,path:`${category}.jpg`}));
  const unknown = {id:9999,kind:'image',category:'photos',path:'unknown.jpg'};
  const result = suggestLoadingPhotos([...photos,...protectedItems,unknown]);
  for (const stage of stages) assert.equal(result.filter(x=>x.included && x.stage===stage).length,4);
  assert.equal(result.find(x=>x.id===9000).included,false);
  assert.ok(protectedItems.every(x=>result.find(y=>y.id===x.id).included));
  assert.equal(result.find(x=>x.id===9999).included,true);
  const sparse = suggestLoadingPhotos(photos.filter(x=>x.ai.stage===75).slice(0,2));
  assert.ok(sparse.every(x=>x.included && x.stage===75));
  assert.ok(suggestLoadingPhotos([{...unknown,id:1},{...unknown,id:2}]).every(x=>x.included && x.stage===''));
});

test('keeps blue bolt seal evidence without a serial and rejects a muted blue door', () => {
  const width = 100, height = 100, pixels = new Uint8ClampedArray(width * height * 4);
  const fill = (left, top, right, bottom, color) => {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) pixels.set([...color, 255], (y * width + x) * 4);
  };
  fill(0, 0, 100, 100, [60, 75, 85]);
  fill(40, 50, 60, 85, [30, 170, 220]);
  assert.equal(sealRegions(pixels, width, height).length, 1);
  fill(0, 0, 100, 100, [80, 130, 160]);
  assert.equal(sealRegions(pixels, width, height).length, 0);
});

test('reads trailer and truck numbers like vehicle plates', () => {
  assert.deepEqual(detectShipmentText('WEIGH BRIDGE TICKET NO 4471 TRUCK NO: NJ AB 12345 GROSS 32000').trailers.map(value => value.id), ['NJ-AB-12345']);
  assert.deepEqual(detectShipmentText('TRAILER # 53 1042').trailers.map(value => value.id), ['53-1042']);
  assert.deepEqual(detectShipmentText('VEHICLE NO. DHAKA METRO TA 11 2345').trailers.map(value => value.id), ['DHAKA-METRO-TA-11-2345']);
  assert.deepEqual(detectShipmentText('TRAILER IN GOOD CONDITION 2024').trailers, []);
});

test('an ISO chassis number is a trailer, not a container', () => {
  const found = detectShipmentText('FLXZ 412345 0 CSQU3054383');
  assert.deepEqual(found.containers.map(value => value.id), ['CSQU3054383']);
  assert.deepEqual(found.trailers.map(value => value.id), ['FLXZ4123450']);
});

test('one trailer in an import is shared by its files', () => {
  const record = (text) => ({ evidence: detectShipmentText(text) });
  const resolved = resolveShipmentGroup([record('TRUCK NO ABC 1234 WEIGH BRIDGE TICKET'), record('CSQU3054383')]);
  assert.deepEqual(resolved.map(value => value.trailer), ['ABC-1234', 'ABC-1234']);
});

test('an invoice that lists net weight and a date is still an invoice', () => {
  assert.equal(detectShipmentText('COMMERCIAL INVOICE NO 551 DATE 12/10/2026 NET WEIGHT: 24,500 KGS').category, 'invoices');
  assert.equal(detectShipmentText('NET WEIGHT 24,520 KG DATE 12/10/2026 OPERATOR SAM').category, 'weight');
});
