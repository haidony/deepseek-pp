import { SYSTEM_TEMPLATE_CHAT, SYSTEM_TEMPLATE_THINKING } from '../constants';
import { SHELL_TOOL_NAMES } from '../shell/contracts';
import type { Memory, ToolDescriptor } from '../types';
import {
  DEFAULT_TOOL_DESCRIPTORS,
  createToolInvocationCatalog,
  getPreferredToolInvocationName,
  getToolInvocationNames,
  type ToolInvocationCatalog,
} from '../tool';
import { estimateTokens, formatMemoriesBlock, getMemoryBudget, selectMemories } from '../memory/selector';
import { markVisibleUserPrompt } from './visibility';

export interface PromptAugmentationOptions {
  memories?: readonly Memory[];
  thinkingEnabled?: boolean;
  identityOnly?: boolean;
  presetContent?: string | null;
  toolDescriptors?: readonly ToolDescriptor[];
}

export interface PromptAugmentationResult {
  augmented: string;
  usedMemoryIds: number[];
  renderedToolCount: number;
}

export function buildPromptAugmentation(
  originalPrompt: string,
  options?: PromptAugmentationOptions,
): PromptAugmentationResult {
  const {
    memories = [],
    thinkingEnabled = false,
    identityOnly = false,
    presetContent = null,
    toolDescriptors = DEFAULT_TOOL_DESCRIPTORS,
  } = options ?? {};

  const promptTokens = estimateTokens(originalPrompt);
  const budget = getMemoryBudget(promptTokens);
  const selected = selectMemories(originalPrompt, [...memories], { budget, identityOnly });
  const memBlock = formatMemoriesBlock(selected);
  const toolsBlock = renderToolSchemas(toolDescriptors);
  const template = thinkingEnabled ? SYSTEM_TEMPLATE_THINKING : SYSTEM_TEMPLATE_CHAT;
  const system = template
    .replace('{{memories}}', memBlock)
    .replace('{{tools}}', toolsBlock);
  const presetPrefix = presetContent ? `${presetContent}\n\n---\n\n` : '';
  const toolReminder = renderToolFormatReminder(toolDescriptors);

  return {
    augmented: presetPrefix + system + markVisibleUserPrompt(originalPrompt) + toolReminder,
    usedMemoryIds: selected.map((memory) => memory.id!).filter(Boolean),
    renderedToolCount: toolDescriptors.length,
  };
}

export function renderToolSchemas(descriptors: readonly ToolDescriptor[] = DEFAULT_TOOL_DESCRIPTORS): string {
  const catalog = createToolInvocationCatalog(descriptors);
  const shellHint = renderShellMcpHint(descriptors, catalog);
  const schemas = descriptors
    .map((descriptor) => renderToolSchema(descriptor, catalog))
    .join('\n\n');
  return [shellHint, schemas].filter(Boolean).join('\n\n');
}

function renderToolSchema(descriptor: ToolDescriptor, catalog: ToolInvocationCatalog): string {
  const examplePayload = createExamplePayload(descriptor);
  const preferredName = getPreferredToolInvocationName(descriptor, catalog);
  const acceptedNames = getToolInvocationNames(descriptor, catalog);
  const lines = [
    `### Tool ${preferredName}`,
    `Title: ${descriptor.title}`,
    `Description: ${descriptor.description}`,
    acceptedNames.length > 1 ? `Accepted tag names: ${acceptedNames.join(', ')}` : '',
    `Valid call format for ${preferredName}:`,
    `<${preferredName}>`,
    JSON.stringify(examplePayload, null, 2),
    `</${preferredName}>`,
    `Invalid formats: <invoke name="${preferredName}">...</invoke>, <tool_call>...</tool_call>`,
    `Parameters JSON Schema: ${JSON.stringify(descriptor.inputSchema)}`,
  ];
  return lines.filter(Boolean).join('\n');
}

function renderShellMcpHint(
  descriptors: readonly ToolDescriptor[],
  catalog: ToolInvocationCatalog,
): string {
  const shellExec = descriptors.find((descriptor) => descriptor.name === 'shell_exec');
  if (!shellExec) return '';

  const shellStatus = descriptors.find((descriptor) => descriptor.name === 'shell_status');
  const execName = getPreferredToolInvocationName(shellExec, catalog);
  const statusName = shellStatus ? getPreferredToolInvocationName(shellStatus, catalog) : null;

  return [
    '### Shell MCP Capability',
    'Shell MCP is connected through the extension. You can execute local CLI commands by emitting the executable XML tool tag; do not say you cannot run commands when this tool is listed.',
    `Use <${execName}> with a JSON body such as {"command":"officecli --version","timeout_ms":60000} to run OfficeCLI or other local CLI tools.`,
    statusName
      ? `Use <${statusName}>{}</${statusName}> first when you need host status, shell, PATH, or working-directory context.`
      : '',
    `Recognized shell tool names: ${SHELL_TOOL_NAMES.join(', ')}`,
  ].filter(Boolean).join('\n');
}

export function renderToolFormatReminder(descriptors: readonly ToolDescriptor[]): string {
  const catalog = createToolInvocationCatalog(descriptors);
  const names = catalog.invocationNames;
  if (names.length === 0) return '';
  return [
    '',
    '',
    '---',
    'Tool call format reminder:',
    `Available tool tag names: ${names.join(', ')}`,
    'These listed tools are executable by the extension. Do not claim you cannot call a listed MCP tool.',
    'To call a tool, use ONLY the direct XML tag whose name is the tool name, with valid JSON as the body.',
    'For MCP tools, prefer the short tag name when it appears in the available names list.',
    'For local file paths, use forward slashes or escaped backslashes so the JSON body remains valid.',
    'Do not use <invoke name="...">, <tool_call>, Markdown code fences, {"tool":"...","arguments":{...}}, or any wrapper format.',
    'Do not put executable tool XML in a thinking/reasoning section; put it in the final assistant answer content.',
  ].join('\n');
}

function createExamplePayload(descriptor: ToolDescriptor): Record<string, unknown> {
  const properties = descriptor.inputSchema.properties ?? {};
  const required = descriptor.inputSchema.required ?? Object.keys(properties);
  const payload: Record<string, unknown> = {};

  for (const key of required) {
    payload[key] = exampleValue(properties[key]);
  }

  return payload;
}

function exampleValue(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return 'value';
  const value = schema as Record<string, unknown>;
  const type = value.type;
  if (Array.isArray(type)) return exampleValue({ ...value, type: type[0] });
  if (value.enum && Array.isArray(value.enum) && value.enum.length > 0) return value.enum[0];
  switch (type) {
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    case 'string':
    default: {
      const desc = typeof value.description === 'string' ? value.description.toLowerCase() : '';
      if (type === 'string' && (desc.includes('file path') || desc.includes('file_path') || desc.includes('filepath'))) {
        if (desc.includes('.pptx')) return './example.pptx';
        if (desc.includes('.docx')) return './example.docx';
        if (desc.includes('.xlsx')) return './example.xlsx';
        return './example.txt';
      }
      return 'value';
    }
  }
}
