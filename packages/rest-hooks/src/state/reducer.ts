import { normalize } from 'rest-hooks/resource';
import { ActionTypes, State, ResponseActions } from 'rest-hooks/types';
import { createReceive } from 'rest-hooks/state/actionCreators';
import {
  RECEIVE_TYPE,
  RECEIVE_MUTATE_TYPE,
  RECEIVE_DELETE_TYPE,
  INVALIDATE_TYPE,
  RESET_TYPE,
  FETCH_TYPE,
} from 'rest-hooks/actionTypes';

import applyUpdatersToResults from './applyUpdatersToResults';
import mergeDeepCopy from './merge/mergeDeepCopy';

export const initialState: State<unknown> = {
  entities: {},
  indexes: {},
  results: {},
  meta: {},
  optimistic: [],
};

export default function reducer(
  state: State<unknown> | undefined,
  action: ActionTypes,
): State<unknown> {
  if (!state) state = initialState;
  switch (action.type) {
    case FETCH_TYPE: {
      // If 'fetch' action reaches the reducer there are no middlewares installed to handle it
      if (process.env.NODE_ENV !== 'production' && !action.meta.nm) {
        console.warn(
          'Fetch appears unhandled - you are likely missing the NetworkManager middleware',
        );
        console.warn(
          'See https://resthooks.io/docs/guides/redux#indextsx for hooking up redux',
        );
      }

      const optimisticResponse = action.meta.optimisticResponse;
      if (optimisticResponse === undefined) return state;
      return {
        ...state,
        optimistic: [
          ...state.optimistic,
          createReceive(optimisticResponse, action.meta, {
            dataExpiryLength: 9999999999999,
          }),
        ],
      };
    }
    case RECEIVE_TYPE: {
      if (action.error) {
        return {
          ...state,
          meta: {
            ...state.meta,
            [action.meta.url]: {
              date: action.meta.date,
              error: action.payload,
              expiresAt: action.meta.expiresAt,
            },
          },
          optimistic: filterOptimistic(state, action),
        };
      }
      const { result, entities, indexes } = normalize(
        action.payload,
        action.meta.schema,
      );
      let results = {
        ...state.results,
        [action.meta.url]: result,
      };
      results = applyUpdatersToResults(results, result, action.meta.updaters);
      return {
        entities: mergeDeepCopy(state.entities, entities),
        indexes: mergeDeepCopy(state.indexes, indexes),
        results,
        meta: {
          ...state.meta,
          [action.meta.url]: {
            date: action.meta.date,
            expiresAt: action.meta.expiresAt,
          },
        },
        optimistic: filterOptimistic(state, action),
      };
    }
    case RECEIVE_MUTATE_TYPE: {
      if (action.error)
        return { ...state, optimistic: filterOptimistic(state, action) };
      const { entities, result, indexes } = normalize(
        action.payload,
        action.meta.schema,
      );
      const results = applyUpdatersToResults(
        state.results,
        result,
        action.meta.updaters,
      );
      return {
        ...state,
        entities: mergeDeepCopy(state.entities, entities),
        indexes: mergeDeepCopy(state.indexes, indexes),
        results,
        optimistic: filterOptimistic(state, action),
      };
    }
    case RECEIVE_DELETE_TYPE: {
      if (action.error)
        return { ...state, optimistic: filterOptimistic(state, action) };
      const key = action.meta.schema.key;
      const pk = action.meta.url;
      const entities = purgeEntity(state.entities, key, pk);
      return {
        ...state,
        entities,
        optimistic: filterOptimistic(state, action),
      };
    }
    case INVALIDATE_TYPE:
      return {
        ...state,
        meta: {
          ...state.meta,
          [action.meta.url]: {
            ...state.meta[action.meta.url],
            expiresAt: 0,
          },
        },
      };
    case RESET_TYPE:
      return initialState;

    default:
      // A reducer must always return a valid state.
      // Alternatively you can throw an error if an invalid action is dispatched.
      return state;
  }
}

type Writable<T> = { [P in keyof T]: NonNullable<Writable<T[P]>> };

/** Filter all requests with same serialization that did not start after the resolving request */
function filterOptimistic(
  state: State<unknown>,
  resolvingAction: ResponseActions,
) {
  return state.optimistic.filter(
    optimisticAction =>
      optimisticAction.meta.url !== resolvingAction.meta.url ||
      optimisticAction.meta.date > resolvingAction.meta.date,
  );
}

// equivalent to entities.deleteIn(key, pk)
function purgeEntity(
  entities: State<unknown>['entities'],
  key: string,
  pk: string,
) {
  const copy: Writable<typeof entities> = { ...entities } as any;
  copy[key] = { ...copy[key] };
  delete copy[key][pk];
  return copy;
}
