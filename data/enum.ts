export const eventNamesLib = Object.freeze({
  CONTENT_FILTER_CLEAR: Symbol("content-filter-clear"),
  DIALOG_OPEN: Symbol("open-dialog"),
  DIALOG_CANCEL: Symbol("cancel-dialog"),
  DIALOG_CONFIRM: Symbol("confirm-dialog"),
  NAVIGATE: Symbol("navigate"),
  SUB_PAGE_CONTAINER: Symbol("sub-page-container"),
  TOGGLE_SPINNING_CIRCLE: Symbol("toggle-spinning-circle")
});

export const generalNamesLib = Object.freeze({
  OBSERVABLE_USER: Symbol("user"),

  BROADCAST_TYPE_REQUEST_STATE: Symbol("request-state"),
  BROADCAST_TYPE_RECEIVE_STATE: Symbol("receive-state"),
  BROADCAST_TYPE_CREATE_OBSERVABLE: Symbol("create-observable"),
  BROADCAST_TYPE_UPDATE_OBSERVABLE: Symbol("update-observable"),

  CONNECTION_LIVE: Symbol("connection-live"),
  CONNECTION_SOLO: Symbol("connection-solo"),
  CONNECTION_OFFLINE: Symbol("connection-offline"),

  CONTENT_FILTER_INPUT_RANGE: Symbol("input-range"),
  CONTENT_FILTER_INPUT_SINGLE: Symbol("input"),
  CONTENT_FILTER_RADIO_MULTI: Symbol("radio-multi"),
  CONTENT_FILTER_RADIO_SINGLE: Symbol("radio"),
  CONTENT_FILTER_SELECTION: Symbol("selection"),
});
