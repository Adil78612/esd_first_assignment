const { saveGeneration, getGeneration, listGenerations } = require('./db');

// Save something new
const r1 = saveGeneration({ id: 'gen-1', type: 'quote', content: 'The obstacle is the way.' });
console.log('1st save of gen-1 :', r1);   // expect { created: true }

// Save the SAME id again — idempotency: should NOT duplicate
const r2 = saveGeneration({ id: 'gen-1', type: 'quote', content: 'The obstacle is the way.' });
console.log('2nd save of gen-1 :', r2);   // expect { created: false }

// Save a different one
saveGeneration({ id: 'gen-2', type: 'art', content: '<svg>...</svg>' });

console.log('fetch gen-1      :', getGeneration('gen-1'));
console.log('total saved      :', listGenerations().length, '(expect 2, not 3)');
