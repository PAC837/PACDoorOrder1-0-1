import { useMemo } from 'react';
import type { ParamDefinition, CheckboxListValue, NumberValue, PresetCheckboxValue, BooleanRadioValue, FixedCheckboxListValue, GroupDepthListValue, TextureCheckboxListValue } from '../../configParams.js';
import type { TextureManifest } from '../../types.js';
import { CommitNumberInput } from '../CommitNumberInput.js';
import { CheckboxListCell } from './CheckboxListCell.js';
import { PresetCheckboxCell } from './PresetCheckboxCell.js';
import { BooleanRadioCell } from './BooleanRadioCell.js';
import { FixedCheckboxListCell } from './FixedCheckboxListCell.js';
import { GroupDepthListCell } from './GroupDepthListCell.js';
import { TextureCheckboxListCell } from './TextureCheckboxListCell.js';

interface ParamCellProps {
  param: ParamDefinition;
  value: unknown;
  allParams: Record<string, unknown>;   // all params for this style (for derived values)
  panelGroups: { id: number; label: string }[];
  edgeGroups: { id: number; label: string }[];
  onChange: (value: unknown) => void;
  onRadioSelect?: () => void;           // for boolean-radio: notify parent to clear others
  textureManifest?: TextureManifest | null;
  onCopyToAll?: () => void;
  toDisplay: (mm: number) => number;
  fromDisplay: (val: number) => number;
  inputStep: number;
}

export function ParamCell({ param, value, allParams, panelGroups, edgeGroups, onChange, onRadioSelect, textureManifest, onCopyToAll, toDisplay, fromDisplay, inputStep }: ParamCellProps) {
  switch (param.type) {
    case 'boolean-radio': {
      const enabled = (value as BooleanRadioValue | undefined)?.enabled ?? false;
      return (
        <BooleanRadioCell
          enabled={enabled}
          onChange={checked => {
            onChange({ enabled: checked });
            if (checked && onRadioSelect) onRadioSelect();
          }}
        />
      );
    }

    case 'checkbox-list': {
      const items = param.source === 'panelGroups' ? panelGroups : edgeGroups;
      const selected = (value as CheckboxListValue | undefined)?.enabledGroupIds ?? [];
      return (
        <CheckboxListCell
          items={items}
          selectedIds={selected}
          onChange={ids => onChange({ enabledGroupIds: ids })}
        />
      );
    }

    case 'number': {
      const num = (value as NumberValue | undefined)?.value ?? 0;
      return (
        <CommitNumberInput
          value={toDisplay(num)}
          onCommit={v => onChange({ value: fromDisplay(v) })}
          style={numberInputStyle}
          step={inputStep}
        />
      );
    }

    case 'fixed-checkbox-list': {
      const items = param.fixedOptions ?? [];
      const selected = (value as FixedCheckboxListValue | undefined)?.enabledOptions
        ?? items.map(i => i.value);  // default: all enabled
      return (
        <FixedCheckboxListCell
          items={items}
          selectedValues={selected}
          onChange={vals => onChange({ enabledOptions: vals })}
        />
      );
    }

    case 'group-depth-list': {
      const items = param.source === 'panelGroups' ? panelGroups : edgeGroups;
      const entries = (value as GroupDepthListValue | undefined)?.entries ?? [];
      return (
        <GroupDepthListCell
          items={items}
          entries={entries}
          onChange={e => onChange({ entries: e })}
          toDisplay={toDisplay}
          fromDisplay={fromDisplay}
          inputStep={inputStep}
        />
      );
    }

    case 'auto-checkbox': {
      const stileMin = (allParams.stileMin as NumberValue | undefined)?.value ?? 44.45;
      const stileMax = (allParams.stileMax as NumberValue | undefined)?.value ?? 88.9;
      const enabled = (value as PresetCheckboxValue | undefined)?.enabledWidths ?? [];
      return (
        <PresetCheckboxCell
          minMm={stileMin}
          maxMm={stileMax}
          enabledWidths={enabled}
          onChange={widths => onChange({ enabledWidths: widths })}
        />
      );
    }

    case 'texture-checkbox-list': {
      const selected = (value as TextureCheckboxListValue | undefined)?.enabledTextures ?? [];
      return (
        <TextureCheckboxListCell
          manifest={textureManifest ?? null}
          selectedPaths={selected}
          onChange={paths => onChange({ enabledTextures: paths })}
          onCopyToAll={onCopyToAll ?? (() => {})}
        />
      );
    }

    default:
      return <span style={{ color: '#666688', fontSize: 11 }}>—</span>;
  }
}

const numberInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid #335577',
  background: '#2a2a4e',
  color: '#e0e0e0',
  fontSize: 11,
  boxSizing: 'border-box',
};
