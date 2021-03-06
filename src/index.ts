import requestPromise from 'request-promise';
import {
  GraphQLFieldConfig,
  GraphQLFieldConfigMap,
  GraphQLObjectType,
  GraphQLSchema,
} from 'graphql';
import {
  Endpoint,
  Endpoints,
  GraphQLParameters,
  GraphQLTypeMap,
  RootGraphQLSchema,
  SwaggerToGraphQLOptions,
} from './types';
import { addTitlesToJsonSchemas, getAllEndPoints, loadSchema } from './swagger';
import { jsonSchemaTypeToGraphQL, mapParametersToFields } from './typeMap';

type ProxyUrl =
  | ((opts: SwaggerToGraphQLOptions) => string)
  | string
  | null
  | undefined;

const resolver = (
  endpoint: Endpoint,
  proxyUrl: ProxyUrl,
  customHeaders = {},
) => async (
  _source: any,
  args: GraphQLParameters,
  opts: SwaggerToGraphQLOptions,
): Promise<any> => {
  const proxy =
    (!proxyUrl
      ? opts.GQLProxyBaseUrl
      : typeof proxyUrl === 'function'
      ? proxyUrl(opts)
      : proxyUrl) || '';
  const req = endpoint.request(args, proxy);
  if (opts.headers) {
    const { host: _host, ...otherHeaders } = opts.headers;
    req.headers = Object.assign(req.headers, otherHeaders, customHeaders);
  } else {
    req.headers = Object.assign(req.headers, customHeaders);
  }
  const { method, body, baseUrl, path, query, headers, bodyType } = req;
  const res = await requestPromise({
    ...(bodyType === 'json' && {
      json: true,
      body,
    }),
    ...(bodyType === 'formData' && {
      form: body,
    }),
    qs: query,
    method,
    headers,
    baseUrl,
    uri: path,
  });
  return res;
};

const getFields = (
  endpoints: Endpoints,
  isMutation: boolean,
  gqlTypes: GraphQLTypeMap,
  proxyUrl: ProxyUrl,
  headers: { [key: string]: string } | undefined,
): GraphQLFieldConfigMap<any, any> => {
  return Object.keys(endpoints)
    .filter((operationId: string) => {
      return !!endpoints[operationId].mutation === !!isMutation;
    })
    .reduce((result, operationId) => {
      const endpoint: Endpoint = endpoints[operationId];
      const type = jsonSchemaTypeToGraphQL(
        operationId,
        endpoint.response || { type: 'string' },
        'response',
        false,
        gqlTypes,
        true,
      );
      const gType: GraphQLFieldConfig<any, any> = {
        type,
        description: endpoint.description,
        args: mapParametersToFields(endpoint.parameters, operationId, gqlTypes),
        resolve: resolver(endpoint, proxyUrl, headers),
      };
      return { ...result, [operationId]: gType };
    }, {});
};

const schemaFromEndpoints = (
  endpoints: Endpoints,
  proxyUrl: ProxyUrl,
  headers: { [key: string]: string } | undefined,
): GraphQLSchema => {
  const gqlTypes = {};
  const queryFields = getFields(endpoints, false, gqlTypes, proxyUrl, headers);
  if (!Object.keys(queryFields).length) {
    throw new Error('Did not find any GET endpoints');
  }
  const rootType = new GraphQLObjectType({
    name: 'Query',
    fields: queryFields,
  });

  const graphQLSchema: RootGraphQLSchema = {
    query: rootType,
  };

  const mutationFields = getFields(
    endpoints,
    true,
    gqlTypes,
    proxyUrl,
    headers,
  );
  if (Object.keys(mutationFields).length) {
    graphQLSchema.mutation = new GraphQLObjectType({
      name: 'Mutation',
      fields: mutationFields,
    });
  }

  return new GraphQLSchema(graphQLSchema);
};

const build = async (
  swaggerPath: string,
  proxyUrl?: ProxyUrl,
  headers?: { [key: string]: string } | undefined,
): Promise<GraphQLSchema> => {
  const swaggerSchema = addTitlesToJsonSchemas(await loadSchema(swaggerPath));
  const endpoints = getAllEndPoints(swaggerSchema);
  return schemaFromEndpoints(endpoints, proxyUrl, headers);
};

module.exports = build;
export default build;
