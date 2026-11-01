export type PathType = 'WebPage' | 'Dialog';

export type Route = {
  content: string;
  title: string;
  description: string;
  pathType: PathType;
  navData?: Record<string, unknown>;
  attributes?: Record<string, string>;
}

export type RouteInfo = {
  content: string;
  title: string;
  description: string;
  canonicalUrl: string;
  structuredData: object;
  navData?: Record<string, unknown>;
  attributes?: Record<string, string>;
}
