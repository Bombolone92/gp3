import { malformedAppearancePdf } from '../fixtures/malformed-appearance.js';
import { updateFieldAppearance } from '../../src/core/form-appearance.js';

const options = JSON.parse(process.argv[2]);
if (options.input === 'invalid-token') options.appearance = '9'.repeat(100000) + 'X';
if (options.input === 'precise-color')
  options.appearance = '0.' + '1'.repeat(100000) + ' g /Helvetica 12 Tf';
const { doc, field } = await malformedAppearancePdf(options);
updateFieldAppearance(field, doc.getForm(), doc.getForm().getDefaultFont());
await doc.save();
process.stdout.write('completed');
