/**
 * Recursive panel tree for arbitrary mid-rail / mid-stile nesting.
 *
 * Each leaf = one routable sub-panel.
 * hsplit = mid-rail (splits Mozaik X / height): children[0]=bottom, children[1]=top
 * vsplit = mid-stile (splits Mozaik Y / width): children[0]=left, children[1]=right
 */

export type PanelTree =
  | { type: 'leaf' }
  | { type: 'hsplit'; pos: number; width: number; children: [PanelTree, PanelTree] }
  | { type: 'vsplit'; pos: number; width: number; children: [PanelTree, PanelTree] };

export interface PanelBounds {
  xMin: number; xMax: number;  // Mozaik X = height
  yMin: number; yMax: number;  // Mozaik Y = width
}

export interface SplitInfo {
  path: number[];           // address from root (e.g. [0, 1] = root.children[0].children[1])
  type: 'hsplit' | 'vsplit';
  pos: number;
  width: number;
  depth: number;            // nesting level for UI indentation
}

/** DFS flatten — bottom-before-top, left-before-right. */
export function flattenTree(tree: PanelTree, bounds: PanelBounds): PanelBounds[] {
  if (tree.type === 'leaf') return [bounds];
  const half = tree.width / 2;
  if (tree.type === 'hsplit') {
    const bottomBounds: PanelBounds = { ...bounds, xMax: tree.pos - half };
    const topBounds: PanelBounds = { ...bounds, xMin: tree.pos + half };
    return [
      ...flattenTree(tree.children[0], bottomBounds),
      ...flattenTree(tree.children[1], topBounds),
    ];
  }
  // vsplit
  const leftBounds: PanelBounds = { ...bounds, yMax: tree.pos - half };
  const rightBounds: PanelBounds = { ...bounds, yMin: tree.pos + half };
  return [
    ...flattenTree(tree.children[0], leftBounds),
    ...flattenTree(tree.children[1], rightBounds),
  ];
}

/** Count leaf nodes. */
export function countLeaves(tree: PanelTree): number {
  if (tree.type === 'leaf') return 1;
  return countLeaves(tree.children[0]) + countLeaves(tree.children[1]);
}

/**
 * Replace the leaf at `leafIndex` (DFS order) with a new split node.
 * Both children of the new split start as leaves.
 */
export function addSplitAtLeaf(
  tree: PanelTree,
  leafIndex: number,
  splitType: 'hsplit' | 'vsplit',
  pos: number,
  width: number,
): PanelTree {
  let consumed = 0;

  function recurse(node: PanelTree): PanelTree {
    if (node.type === 'leaf') {
      if (consumed === leafIndex) {
        consumed++;
        return {
          type: splitType,
          pos,
          width,
          children: [{ type: 'leaf' }, { type: 'leaf' }],
        };
      }
      consumed++;
      return node;
    }
    const newLeft = recurse(node.children[0]);
    const newRight = recurse(node.children[1]);
    if (newLeft === node.children[0] && newRight === node.children[1]) return node;
    return { ...node, children: [newLeft, newRight] };
  }

  return recurse(tree);
}

/** Navigate to a node by path (array of child indices). */
function getNodeAtPath(tree: PanelTree, path: number[]): PanelTree {
  let node = tree;
  for (const idx of path) {
    if (node.type === 'leaf') return node;
    node = node.children[idx];
  }
  return node;
}

/** Remove a split node (collapse to leaf). */
export function removeSplit(tree: PanelTree, path: number[]): PanelTree {
  if (path.length === 0) return { type: 'leaf' };

  function recurse(node: PanelTree, depth: number): PanelTree {
    if (node.type === 'leaf') return node;
    const childIdx = path[depth];
    if (depth === path.length - 1) {
      // Replace the child at childIdx with a leaf
      const newChildren: [PanelTree, PanelTree] = [...node.children];
      newChildren[childIdx] = { type: 'leaf' };
      // If both children are now leaves, collapse this node to a leaf too?
      // No — only remove the targeted split. The parent split remains.
      return { ...node, children: newChildren };
    }
    const newChild = recurse(node.children[childIdx], depth + 1);
    if (newChild === node.children[childIdx]) return node;
    const newChildren: [PanelTree, PanelTree] = [...node.children];
    newChildren[childIdx] = newChild;
    return { ...node, children: newChildren };
  }

  return recurse(tree, 0);
}

/** Update pos/width of the split at the given path. */
export function updateSplit(
  tree: PanelTree,
  path: number[],
  pos: number,
  width: number,
): PanelTree {
  if (path.length === 0) {
    // Root is the split node
    if (tree.type === 'leaf') return tree;
    return { ...tree, pos, width };
  }

  function recurse(node: PanelTree, depth: number): PanelTree {
    if (node.type === 'leaf') return node;
    if (depth === path.length - 1) {
      const childIdx = path[depth];
      const child = node.children[childIdx];
      if (child.type === 'leaf') return node;
      const newChild = { ...child, pos, width };
      const newChildren: [PanelTree, PanelTree] = [...node.children];
      newChildren[childIdx] = newChild;
      return { ...node, children: newChildren };
    }
    const childIdx = path[depth];
    const newChild = recurse(node.children[childIdx], depth + 1);
    if (newChild === node.children[childIdx]) return node;
    const newChildren: [PanelTree, PanelTree] = [...node.children];
    newChildren[childIdx] = newChild;
    return { ...node, children: newChildren };
  }

  return recurse(tree, 0);
}

/** Enumerate all split nodes for UI editing. */
export function enumerateSplits(tree: PanelTree): SplitInfo[] {
  const result: SplitInfo[] = [];

  function recurse(node: PanelTree, path: number[], depth: number) {
    if (node.type === 'leaf') return;
    result.push({
      path: [...path],
      type: node.type,
      pos: node.pos,
      width: node.width,
      depth,
    });
    recurse(node.children[0], [...path, 0], depth + 1);
    recurse(node.children[1], [...path, 1], depth + 1);
  }

  recurse(tree, [], 0);
  return result;
}

/**
 * Convert library door Divider data to a PanelTree.
 * Library doors only have horizontal dividers (mid-rails), no mid-stiles,
 * so the result is a chain of hsplits (bottom-up).
 */
export function libraryDoorToTree(
  dividers: { DB: number; DBStart: number }[] | undefined,
): PanelTree {
  if (!dividers || dividers.length === 0) return { type: 'leaf' };

  // Sort by position (bottom to top)
  const sorted = [...dividers].sort((a, b) => a.DBStart - b.DBStart);

  // Build chain from top down: the topmost divider is the root split,
  // its bottom child contains the rest of the chain
  let tree: PanelTree = { type: 'leaf' };
  for (let i = sorted.length - 1; i >= 0; i--) {
    const d = sorted[i];
    const pos = d.DBStart + d.DB / 2;
    tree = {
      type: 'hsplit',
      pos,
      width: d.DB,
      children: [tree, { type: 'leaf' }],
    };
  }

  return tree;
}
