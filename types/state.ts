export type BroadcastMessageType = 'create-observable' | 'receive-state' | 'request-state' | 'update-observable' | 'remove-observable';

export type BroadcastMessage = {
  type: BroadcastMessageType;
  /** Unique id of the State instance (tab) that sent the message. */
  senderId: string;
  /** Set on directed messages (e.g. 'receive-state'): only the tab with this id should handle it. */
  targetId?: string;
  name: string;
  data: any;
  time: number;
  options: BroadcastMessageOptions;
};

export type BroadcastMessageOptions = {
  localStorage?: boolean;
  broadcastCreation?: boolean;
}

export type CreateInternalOptions = {
  /** persist the observable in local storage (an already stored value wins over the given one) */
  persist: boolean;
  /** broadcast the creation to other tabs (always done for persisted observables) */
  broadcast: boolean;
  /** the observable is only a placeholder, created by a subscriber, until the real value arrives */
  defaulted: boolean;
};

export type Listener = (subscriber: string, watchedPath: string, updatedValue: any) => void;

export type ObservableOptions = {
  localStorage: boolean;
  broadcastCreation: boolean;
}

export type StateSnapshotEntry = {
  value: any;
  /** Whether the observable is persisted in local storage. */
  localStorage: boolean;
}

/** The payload of a 'receive-state' message: observable name -> its value & persistence info. */
export type StateSnapshot = Record<string, StateSnapshotEntry>;
