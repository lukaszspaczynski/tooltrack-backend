// The request bodies, named — and each one is the Zod schema that actually
// refuses a bad body at runtime, not a description of it.
//
// This is the half of the contract that used to be written twice. A rule lived
// here as `maxLength: 200` and in `*-input.ts` as a length check, and nothing
// made the first follow the second: changing the parser left the document
// saying the old number, and no test could tell. Now there is one object. The
// schema that rejects a 201-character name is the schema that puts
// `"maxLength": 200` in docs/openapi.json.
//
// What is deliberately absent is the query strings. A list forgives — a link
// somebody pasted with `?limit=banana` still shows the catalog, clamped — and
// a schema that forgives is a schema that accepts anything, which tells a
// client less than the parameter list in `src/openapi/paths/` already does.

import type { ZodType } from 'zod'

import {
  LANGUAGE_SCHEMA,
  LOGIN_SCHEMA,
  PASSWORD_CHANGE_SCHEMA,
  REGISTER_SCHEMA,
  TOKEN_SCHEMA,
} from '../server/routes/auth-input'
import { BRAND_CREATE_SCHEMA, BRAND_PATCH_SCHEMA, LOGO_SCHEMA } from '../server/routes/brands-input'
import {
  CASE_CREATE_SCHEMA,
  CASE_PATCH_SCHEMA,
  LABEL_SLOT_SCHEMA,
} from '../server/routes/cases-input'
import {
  MANUAL_TITLE_SCHEMA,
  MANUAL_URL_SCHEMA,
  MANUAL_IDS_SCHEMA,
} from '../server/routes/manuals-input'
import { ATTACH_IDS_SCHEMA, DELETE_IDS_SCHEMA } from '../server/routes/media-input'
import {
  LABEL_IDS_SCHEMA,
  LABEL_REQUEST_SCHEMA,
  ORGANIZER_CREATE_SCHEMA,
  ORGANIZER_PATCH_SCHEMA,
  TOOL_IDS_SCHEMA,
} from '../server/routes/organizers-input'
import {
  CUTOUT_COMMIT_SCHEMA,
  CUTOUT_METHOD_SCHEMA,
  CUTOUT_RUN_SCHEMA,
  CUTOUT_THRESHOLD_SCHEMA,
  GLOBAL_ENGINE_SCHEMA,
  USER_ENGINE_SCHEMA,
} from '../server/routes/settings-input'
import {
  ATTRIBUTE_CREATE_SCHEMA,
  ATTRIBUTE_PATCH_SCHEMA,
  IMPORT_SCHEMA,
  TOOL_CREATE_SCHEMA,
  TOOL_PATCH_SCHEMA,
} from '../server/routes/tools-input'
import { USER_PATCH_SCHEMA } from '../server/routes/users-input'

export const REQUEST_SCHEMAS: Record<string, ZodType> = {
  AttributeCreateBody: ATTRIBUTE_CREATE_SCHEMA,
  AttributePatchBody: ATTRIBUTE_PATCH_SCHEMA,
  BrandCreateBody: BRAND_CREATE_SCHEMA,
  BrandLogoBody: LOGO_SCHEMA,
  BrandPatchBody: BRAND_PATCH_SCHEMA,
  CaseCreateBody: CASE_CREATE_SCHEMA,
  CaseLabelSlotBody: LABEL_SLOT_SCHEMA,
  CasePatchBody: CASE_PATCH_SCHEMA,
  CutoutCommitBody: CUTOUT_COMMIT_SCHEMA,
  CutoutMethodBody: CUTOUT_METHOD_SCHEMA,
  CutoutRunBody: CUTOUT_RUN_SCHEMA,
  CutoutThresholdBody: CUTOUT_THRESHOLD_SCHEMA,
  ImportUrlBody: IMPORT_SCHEMA,
  LabelIdsBody: LABEL_IDS_SCHEMA,
  LabelRequestBody: LABEL_REQUEST_SCHEMA,
  LanguageBody: LANGUAGE_SCHEMA,
  LoginBody: LOGIN_SCHEMA,
  ManualIdsBody: MANUAL_IDS_SCHEMA,
  ManualTitleBody: MANUAL_TITLE_SCHEMA,
  ManualUrlBody: MANUAL_URL_SCHEMA,
  OrganizerCreateBody: ORGANIZER_CREATE_SCHEMA,
  OrganizerPatchBody: ORGANIZER_PATCH_SCHEMA,
  PasswordChangeBody: PASSWORD_CHANGE_SCHEMA,
  PhotoAttachBody: ATTACH_IDS_SCHEMA,
  PhotoDeleteBody: DELETE_IDS_SCHEMA,
  RegisterBody: REGISTER_SCHEMA,
  SearchEngineBody: GLOBAL_ENGINE_SCHEMA,
  SearchEngineMineBody: USER_ENGINE_SCHEMA,
  TokenBody: TOKEN_SCHEMA,
  ToolCreateBody: TOOL_CREATE_SCHEMA,
  ToolIdsBody: TOOL_IDS_SCHEMA,
  ToolPatchBody: TOOL_PATCH_SCHEMA,
  UserPatchBody: USER_PATCH_SCHEMA,
}
