import { JSONSchema4 } from 'json-schema';
import { isEmpty as _isEmpty } from 'lodash-es';
import { IArrayNode, IObjectNode, ITreeNodeMeta, SchemaKind, SchemaTreeListNode } from '../types';
import { DIVIDERS } from './dividers';
import { getArraySubtype } from './getArraySubtype';
import { getPrimaryType } from './getPrimaryType';
import { isCombiner } from './isCombiner';
import { isCombinerNode, isRefNode } from './nodes';
import { walk } from './walk';

export type WalkingOptions = {
  depth?: number;
};

export type Walker = (
  schema: JSONSchema4,
  level?: number,
  meta?: ITreeNodeMeta,
  options?: WalkingOptions,
) => IterableIterator<SchemaTreeListNode>;

const getProperties: Walker = function*(schema, level = 0, meta) {
  if (schema.properties !== undefined) {
    const { path } = meta!;
    for (const [prop, property] of Object.entries(schema.properties)) {
      yield* renderSchema(property, level + 1, {
        name: prop,
        required: Array.isArray(schema.required) && schema.required.includes(prop),
        path: [...path, prop],
      });
    }
  }
};

const getPatternProperties: Walker = function*(schema, level = 0, meta) {
  if (schema.patternProperties !== undefined) {
    const { path } = meta!;
    for (const [prop, property] of Object.entries(schema.patternProperties)) {
      yield* renderSchema(property, level + 1, {
        name: prop,
        path: [...path, prop],
        pattern: true,
      });
    }
  }
};

export const renderSchema: Walker = function*(schema, level = 0, meta = { path: [] }, options = {}) {
  if (typeof schema !== 'object' || schema === null) {
    throw new TypeError(
      `Expected schema to be an "object" but received ${schema === null ? '"null"' : `a "${typeof schema}"`}`,
    );
  }

  if (options.depth !== undefined && level >= options.depth) return;

  const parsedSchema = schema;

  const { path } = meta;

  for (const node of walk(parsedSchema)) {
    const baseNode: SchemaTreeListNode = {
      id: node.id,
      level,
      name: '',
      metadata: {
        ...node,
        ...meta,
        ...(parsedSchema.items !== undefined &&
          !Array.isArray(parsedSchema.items) && {
            subtype: getArraySubtype(parsedSchema as IArrayNode),
          }),
        path,
      },
    };

    if (isRefNode(node)) {
      // we expect the schema to be dereferenced
      // const resolved = lookupRef(path, dereferencedSchema);
      // if (resolved) {
      //   yield* renderSchema(
      //     resolved,
      //     level,
      //     {
      //       ...meta,
      //       inheritedFrom: node.$ref,
      //     },
      //     { mergeAllOf: false },
      //   );
      // }
      yield {
        ...baseNode,
        metadata: {
          ...baseNode.metadata,
          $ref: node.$ref,
        },
      } as SchemaTreeListNode;
    } else if (isCombinerNode(node)) {
      yield {
        ...baseNode,
        canHaveChildren: true,
      };

      if (node.properties !== undefined) {
        for (const [i, property] of node.properties.entries()) {
          if ('type' in node) {
            node.properties[i] = {
              ...property,
              type: property.type || node.type,
            };
          }

          yield* renderSchema(node.properties[i], level + 1, {
            ...(i !== 0 && { divider: DIVIDERS[node.combiner] }),
            path: [...path, node.combiner, i],
          });
        }
      }
    } else {
      switch (getPrimaryType(node)) {
        case SchemaKind.Array:
          yield {
            ...baseNode,
            ...('items' in node &&
              !_isEmpty(node.items) &&
              (baseNode.metadata!.subtype === 'object' ||
                Array.isArray(node.items) ||
                (typeof baseNode.metadata!.subtype === 'string' && isCombiner(baseNode.metadata!.subtype))) && {
                canHaveChildren: true,
              }),
            metadata: {
              ...baseNode.metadata,
              // https://tools.ietf.org/html/draft-fge-json-schema-validation-00#section-5.3.1.2
              ...(!('subtype' in baseNode) &&
                (node as IArrayNode).additionalItems && { additional: (node as IArrayNode).additionalItems }),
            },
          } as SchemaTreeListNode;

          if (Array.isArray(parsedSchema.items)) {
            for (const [i, property] of parsedSchema.items.entries()) {
              yield* renderSchema(property, level + 1, {
                path: [...path, 'items', i],
              });
            }
          } else if (parsedSchema.items) {
            const subtype = baseNode.metadata!.subtype;
            switch (subtype) {
              case SchemaKind.Object:
                yield* getProperties(parsedSchema.items, level, {
                  ...meta,
                  path: [...path, 'items', 'properties'],
                });
                break;
              case SchemaKind.Array:
                yield* renderSchema(parsedSchema.items, level, {
                  ...meta,
                  path: [...path, 'items'],
                });
                break;
              default:
                if (typeof subtype === 'string' && isCombiner(subtype)) {
                  yield* renderSchema(parsedSchema.items, level + 1, {
                    ...meta,
                    path: [...path, 'items'],
                  });
                }
            }
          }

          break;
        case SchemaKind.Object:
          yield {
            ...baseNode,
            ...('properties' in node && !_isEmpty(node.properties) && { canHaveChildren: true }),
            metadata: {
              ...baseNode.metadata,
              ...((node as IObjectNode).additionalProperties && {
                additional: (node as IObjectNode).additionalProperties,
              }),
            },
          } as SchemaTreeListNode;

          yield* getProperties(parsedSchema, level, {
            path: [...path, 'properties'],
          });

          yield* getPatternProperties(parsedSchema, level, {
            path: [...path, 'patternProperties'],
          });

          break;
        default:
          yield baseNode;
      }
    }
  }
};
