// Keep tests independent of the user's installed project catalog.
import { resolve } from 'node:path';
process.env.FRACTAL_CATALOG = '';
process.env.FRACTAL_MODELS_DIR = resolve('examples');
