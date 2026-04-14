// src/core/kdTree.js
import { deltaE76 } from './colorSpace.js';

class Node {
  constructor(obj, dimension, parent) {
    this.obj = obj;
    this.left = null;
    this.right = null;
    this.parent = parent;
    this.dimension = dimension;
  }
}

export class KDTree {
  /**
   * @param {Array} points 
   * @param {string[]} dimensions e.g. ['L', 'a', 'b']
   */
  constructor(points, dimensions) {
    this.dimensions = dimensions;
    this.root = this.buildTree(points, 0, null);
  }

  buildTree(points, depth, parent) {
    if (points.length === 0) return null;

    const dim = depth % this.dimensions.length;
    const sorted = [...points].sort((a, b) => a[this.dimensions[dim]] - b[this.dimensions[dim]]);
    const medianIndex = Math.floor(sorted.length / 2);
    
    const node = new Node(sorted[medianIndex], dim, parent);
    node.left = this.buildTree(sorted.slice(0, medianIndex), depth + 1, node);
    node.right = this.buildTree(sorted.slice(medianIndex + 1), depth + 1, node);
    
    return node;
  }

  /**
   * Find nearest neighbors
   * @param {Object} targetPoint {L, a, b}
   * @param {number} maxNodes Limit results
   * @returns {Array} List of nodes with distance
   */
  nearest(targetPoint, maxNodes = 1) {
    let bestNodes = [];
    
    const metric = (a, b) => deltaE76(
        [a.L, a.a, a.b], 
        [b.L, b.a, b.b]
    );

    const saveNode = (node, distance) => {
      bestNodes.push({ node, distance });
      bestNodes.sort((a, b) => a.distance - b.distance);
      if (bestNodes.length > maxNodes) {
        bestNodes.pop();
      }
    };

    const nearestSearch = (node) => {
      if (!node) return;

      const nodeDistance = metric(node.obj, targetPoint);
      const dimension = this.dimensions[node.dimension];
      const pointDim = targetPoint[dimension];
      const nodeDim = node.obj[dimension];
      
      let bestChild = pointDim < nodeDim ? node.left : node.right;
      let otherChild = pointDim < nodeDim ? node.right : node.left;

      nearestSearch(bestChild);

      if (bestNodes.length < maxNodes || nodeDistance < bestNodes[bestNodes.length - 1].distance) {
        saveNode(node, nodeDistance);
      }

      if (bestNodes.length < maxNodes || Math.abs(pointDim - nodeDim) < bestNodes[bestNodes.length - 1].distance) {
        nearestSearch(otherChild);
      }
    };

    nearestSearch(this.root);
    return bestNodes;
  }
}
