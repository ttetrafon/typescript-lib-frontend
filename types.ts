////////////////////
//   NAVIGATION   //
////////////////////

export type PathType = 'WebPage' | 'Dialog';

export type Route = {
  content: string;
  title: string;
  description: string;
  pathType: PathType;
  navData?: Record<string, unknown>;
}

export type RouteInfo = {
  content: string;
  title: string;
  description: string;
  canonicalUrl: string;
  structuredData: object;
  navData?: Record<string, unknown>;
}

///////////////
//   STATE   //
///////////////

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

////////////////
//   WINDOW   //
////////////////

export type WindowSize = {
  height: number;
  width: number;
}
