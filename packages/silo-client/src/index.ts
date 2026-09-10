/**
 * The published surface. Everything a consumer can reach is named here, and
 * nothing else is: the transport, the path builder and the scope plumbing stay
 * internal, because a route the client does not cover should be a client
 * change rather than a hand-built request.
 */

export { Silo } from "./silo.js";
export type { SiloOptions } from "./silo-options.js";
export type { RequestOptions } from "./request-options.js";
export type { FetchFunction } from "./transport/fetch-function.js";
export { RouteInventory } from "./transport/route-inventory.js";

// Projects and environments
export { Projects } from "./scope/projects.js";
export { ProjectHandle } from "./scope/project-handle.js";
export { Environments } from "./scope/environments.js";
export { EnvironmentHandle } from "./scope/environment-handle.js";
export { RenameReport } from "./scope/rename-report.js";
export type { Project } from "./scope/project.js";
export type { Environment } from "./scope/environment.js";
export type { RenameOptions } from "./scope/rename-options.js";
export type { DeleteOptions } from "./scope/delete-options.js";

// Collections and schemas
export { Collections } from "./collections/collections.js";
export { CollectionHandle } from "./collections/collection-handle.js";
export { CollectionSchema } from "./collections/collection-schema.js";
export { ReservedFieldNames } from "./collections/reserved-field-names.js";
export type { CollectionSummary } from "./collections/collection-summary.js";
export type { CollectionDefinition } from "./collections/collection-definition.js";
export type { JsonSchema } from "./collections/json-schema.js";

// Entries
export { EntryBase } from "./entries/entry-base.js";
export { ResolvedEntry } from "./entries/resolved-entry.js";
export { Entry } from "./entries/entry.js";
export { EntryPage } from "./entries/entry-page.js";
export { EntryStream } from "./entries/entry-stream.js";
export { EntryPageStream } from "./entries/entry-page-stream.js";
export { EntryReader } from "./entries/entry-reader.js";
export type { EntryListQuery } from "./entries/entry-list-query.js";
export type { EntryPayload } from "./entries/entry-payload.js";

// Queries
export { Filter } from "./query/filter.js";
export { TypedFilter } from "./query/typed-filter.js";
export { FilterField } from "./query/filter-field.js";
export { FilterExpression } from "./query/filter-expression.js";
export { FieldPath } from "./query/field-path.js";
export { Sort } from "./query/sort.js";
export { SortTerm } from "./query/sort-term.js";
export { FilterOperators } from "./query/filter-operator.js";
export type { FilterNode } from "./query/filter-node.js";
export type { FilterOperator } from "./query/filter-operator.js";
export type { SortDirection } from "./query/sort-term.js";

// Pagination
export { Page } from "./pagination/page.js";
export { PageWindow } from "./pagination/page-window.js";
export { RowStream } from "./pagination/row-stream.js";

// Search
export { Search } from "./search/search.js";
export { SearchReach } from "./search/search-reach.js";
export { SearchPage } from "./search/search-page.js";
export type { SearchQuery } from "./search/search-query.js";
export type { SearchHit } from "./search/search-hit.js";
export type { SearchSnippet } from "./search/search-snippet.js";
export type { SearchEngine } from "./search/search-engine.js";

// Variables
export { ProjectVariables } from "./variables/project-variables.js";
export { EnvironmentVariables } from "./variables/environment-variables.js";
export { Variable } from "./variables/variable.js";
export type { VariableDeclaration } from "./variables/variable-declaration.js";
export type { DeclareVariableOptions, VariableEnvironmentOptions } from "./variables/project-variables.js";

// Media
export { Media } from "./media/media.js";
export { MediaAsset } from "./media/media-asset.js";
export { MediaFolders } from "./media/media-folders.js";
export { MediaReference } from "./media/media-reference.js";
export { MediaPage } from "./media/media-page.js";
export { MediaStream } from "./media/media-stream.js";
export { MediaPageStream } from "./media/media-page-stream.js";
export { MediaUsagePage } from "./media/media-usage-page.js";
export { MediaDeleteReport } from "./media/media-delete-report.js";
export type { MediaAssetRecord } from "./media/media-asset.js";
export type { MediaQuery } from "./media/media-query.js";
export type { MediaUsage } from "./media/media-usage.js";
export type { MediaUsageQuery } from "./media/media-usage-page.js";
export type { MediaUpload, MediaUploadBytes, MediaUploadFileOptions } from "./media/media-upload.js";
export type { MediaDeleteFailure } from "./media/media-delete-failure.js";
export type { MediaDeleteOptions } from "./media/media-delete-options.js";
export type { MediaFolderMoveOptions } from "./media/media-folder-move.js";
export type { MediaFolderDeleteOptions } from "./media/media-folder-delete.js";

// Instance
export type { HealthReport } from "./instance/health-report.js";

// Errors
export { SiloError } from "./errors/silo-error.js";
export { ValidationFailedError } from "./errors/validation-failed-error.js";
export { UnauthorizedError } from "./errors/unauthorized-error.js";
export { ForbiddenError } from "./errors/forbidden-error.js";
export { NotFoundError } from "./errors/not-found-error.js";
export { ConflictError } from "./errors/conflict-error.js";
export { MediaInUseError } from "./errors/media-in-use-error.js";
export { MediaDeleteStalledError } from "./errors/media-delete-stalled-error.js";
export { InternalError } from "./errors/internal-error.js";
export { NetworkError } from "./errors/network-error.js";
export { TimeoutError } from "./errors/timeout-error.js";
export { RequestAbortedError } from "./errors/request-aborted-error.js";
export { InvalidResponseError } from "./errors/invalid-response-error.js";
export type { ErrorCode } from "./errors/error-code.js";
export type { ValidationDetail } from "./errors/validation-detail.js";
