/**
 * Review worker entry. Deployed by the owner's app to their own Puter
 * account (see src/review/api.js); `router` and `me` are runtime globals.
 */
/* global router, me, __WORKER_BUILD__, __WORKER_BUILT_AT__ */
import { health, handleApi } from './http.js';

router.get('/health', () => health(__WORKER_BUILD__, __WORKER_BUILT_AT__));
router.post('/api', (ctx) => handleApi(ctx, me.puter));
