import type { ToolType } from "@foundry2d/core";

export const setToolSchema = {
  type: "string",
  enum: ["pen", "eraser", "bucket", "eyedropper"],
} as const satisfies { type: string; enum: ToolType[] };

export const setColorSchema = {
  type: "object",
  properties: {
    color: {
      type: "string",
    },
  },
  required: ["color"],
  additionalProperties: false,
} as const;

export const setPenSizeSchema = {
  type: "object",
  properties: {
    size: {
      type: "number",
      minimum: 1,
      maximum: 32,
    },
  },
  required: ["size"],
  additionalProperties: false,
} as const;

export const gridToggleSchema = {
  type: "object",
  properties: {
    enabled: {
      type: "boolean",
    },
  },
  required: ["enabled"],
  additionalProperties: false,
} as const;

export const documentResizeSchema = {
  type: "object",
  properties: {
    width: {
      type: "number",
      minimum: 1,
    },
    height: {
      type: "number",
      minimum: 1,
    },
  },
  required: ["width", "height"],
  additionalProperties: false,
} as const;
