export type ObservableOptions = {
  localStorage: boolean;
  broadcastCreation: boolean;
}

export type BroadcastMessageType = 'create-observable' | 'receive-state' | 'request-state' | 'update-observable';

export type BroadcastMessage = {
  type: BroadcastMessageType;
  name: string;
  data: any;
  time: number;
  options: BroadcastMessageOptions;
};

export type BroadcastMessageOptions = {
  localStorage?: boolean;
  broadcastCreation?: boolean;
}

export type Listener = (subscriber: string, watchedPath: string, updatedValue: any) => void;
