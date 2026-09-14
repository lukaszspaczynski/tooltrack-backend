// Server-wide and per-account settings.
//
// **No credential ever comes back.** Every answer on this surface carries only
// whether a key is set, where it came from, and its last few characters. A form
// therefore never receives a key it could send back, which is why an absent
// field leaves the stored credential alone and an empty string is what clears
// it — leaving an input untouched must not wipe what is saved.
//
// Ownership is split on purpose. The **keys and the global switches belong to
// the installation** and need `users.manage`; **which of the configured engines
// a given person searches with is their own business** and costs nobody
// anything to get wrong. The read is the same for everybody, because the screen
// has to be able to show a non-admin what exists and why the search button is
// grey.
//
// The cutout has no per-account half: which methods exist decides what the
// installation spends, and that is not an individual preference.

import {
  arrayOf,
  errors,
  jsonBody,
  jsonResponse,
  object,
  type OperationSpec,
  ref,
} from '../operation'

const SEARCH_PROVIDERS = ['google', 'brave', 'openverse', 'mistama']
const CUTOUT_METHODS = ['local', 'removebg', 'gemini']

const ENGINES = jsonResponse(
  'Every engine, and how many are actually usable by this account.',
  object({
    engines: arrayOf(ref('EngineSettings')),
    usable: {
      description:
        'How many engines are configured, globally on, and switched on by this account. Zero means the search button has nothing to run — derived here rather than guessed from three flags in the browser.',
      type: 'integer',
    },
  }),
)

const CUTOUT = jsonResponse('Every method, and the shared threshold.', ref('CutoutSettings'))

export const SETTINGS_OPERATIONS: OperationSpec[] = [
  {
    description:
      'Readable by anybody who may write to the catalog, so the screen can explain a grey search button rather than just showing one. Carries no key — only `keyHint`, `keySource` and whether one is set at all.',
    operationId: 'getSearchEngineSettings',
    responses: { 200: ENGINES, ...errors(401, 403, 503) },
    route: 'GET /api/settings/search-engines',
    summary: 'The search engines',
    tag: 'settings',
  },
  {
    description:
      'The installation’s half: the credentials, the global switch, and how many pictures this engine contributes to one search.\n\nAn **absent** `apiKey` or `apiSecret` leaves what is stored alone; an **empty string** clears it. The form relies on that, because it never receives a key from the server and so cannot send one back.\n\nThe saved list comes back, including the masked hint, so the screen shows the new state without asking again.',
    operationId: 'updateSearchEngine',
    pathParams: {
      provider: {
        description: 'Which engine.',
        schema: { enum: SEARCH_PROVIDERS, type: 'string' },
      },
    },
    requestBody: jsonBody(ref('SearchEngineBody')),
    responses: {
      200: ENGINES,
      404: jsonResponse('No engine by that name.', ref('Error')),
      ...errors(400, 401, 403, 503),
    },
    route: 'PATCH /api/settings/search-engines/:provider',
    summary: 'Configure a search engine',
    tag: 'settings',
  },
  {
    description:
      'The caller’s own half, and the only thing here they may change: whether their searches use this engine. It cannot turn on an engine the installation has switched off or left without a key — `usable` in the answer is what says whether anything will actually run.',
    operationId: 'updateMySearchEngine',
    pathParams: {
      provider: {
        description: 'Which engine.',
        schema: { enum: SEARCH_PROVIDERS, type: 'string' },
      },
    },
    requestBody: jsonBody(ref('SearchEngineMineBody')),
    responses: {
      200: ENGINES,
      404: jsonResponse('No engine by that name.', ref('Error')),
      ...errors(400, 401, 403, 503),
    },
    route: 'PATCH /api/me/search-engines/:provider',
    summary: 'Switch an engine on or off for yourself',
    tag: 'settings',
  },
  {
    description:
      'Readable by anybody who may read the catalog, for the same reason the engine list is: whoever presses the wand should be able to see which methods exist and why one is missing. No credential in it.',
    operationId: 'getCutoutSettings',
    responses: { 200: CUTOUT, ...errors(401, 403, 503) },
    route: 'GET /api/settings/cutout',
    summary: 'The cutout methods',
    tag: 'settings',
  },
  {
    description:
      'The one setting that is not a method: the local method’s threshold, which the cutout screen offers as a starting point. Summed over the three channels, so 765 is pure white.',
    operationId: 'updateCutoutThreshold',
    requestBody: jsonBody(ref('CutoutThresholdBody')),
    responses: { 200: CUTOUT, ...errors(400, 401, 403, 503) },
    route: 'PATCH /api/settings/cutout',
    summary: 'Set the local method’s threshold',
    tag: 'settings',
  },
  {
    description:
      'One method’s switch and key, exactly like a search engine’s — and with the same rule about an absent field against an empty one.\n\nSending an `apiKey` for `local` is a 400: it has no key to set, and storing one would be storing a value nothing reads.',
    operationId: 'updateCutoutMethod',
    pathParams: {
      method: { description: 'Which method.', schema: { enum: CUTOUT_METHODS, type: 'string' } },
    },
    requestBody: jsonBody(ref('CutoutMethodBody')),
    responses: {
      200: CUTOUT,
      400: jsonResponse(
        'The body did not parse, or it carries a key for the local method, which has none.',
        ref('Error'),
      ),
      404: jsonResponse('No method by that name.', ref('Error')),
      ...errors(401, 403, 503),
    },
    route: 'PATCH /api/settings/cutout/:method',
    summary: 'Configure a cutout method',
    tag: 'settings',
  },
]
