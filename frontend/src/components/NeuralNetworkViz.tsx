import { useEffect, useRef } from 'react';
import './NeuralNetworkViz.css';

interface NetworkMetadata {
  embedding_stats: {
    dimension: number;
    norm: number;
    active_dimensions: number;
  };
  retrieval_stats: Array<{
    score: number;
    doc_id: string;
  }>;
  generation_stats: {
    tokens: number;
    time_ms: number;
  };
}

interface NeuralNetworkVizProps {
  isProcessing: boolean;
  metadata?: NetworkMetadata;
  processingStage?: 'embedding' | 'retrieval' | 'generation' | 'idle';
}

interface Node {
  x: number;
  y: number;
  radius: number;
  activation: number;
  layer: number;
  index: number;
}

interface Connection {
  from: Node;
  to: Node;
  weight: number;
}

export default function NeuralNetworkViz({ isProcessing, metadata, processingStage = 'idle' }: NeuralNetworkVizProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const nodesRef = useRef<Node[]>([]);
  const connectionsRef = useRef<Connection[]>([]);
  const timeRef = useRef<number>(0);
  const layersRef = useRef<Array<{ name: string; y: number }>>([]);

  // Initialize network structure
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const updateSize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    updateSize();
    window.addEventListener('resize', updateSize);

    // Network architecture
    const layers = [
      { name: 'Embedding', nodeCount: 16, y: 0.2 },      // Represent 1536 dims with 16 nodes
      { name: 'Retrieval', nodeCount: 3, y: 0.5 },      // Top-3 matches
      { name: 'Generation', nodeCount: 8, y: 0.8 }      // Token generation
    ];

    // Create nodes
    const nodes: Node[] = [];
    layers.forEach((layer, layerIdx) => {
      const spacing = 1 / (layer.nodeCount + 1);
      for (let i = 0; i < layer.nodeCount; i++) {
        nodes.push({
          x: spacing * (i + 1),
          y: layer.y,
          radius: 8,
          activation: 0,
          layer: layerIdx,
          index: i
        });
      }
    });

    // Create connections between adjacent layers
    const connections: Connection[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      // Connect to all nodes in next layer
      const nextLayerNodes = nodes.filter(n => n.layer === node.layer + 1);
      nextLayerNodes.forEach(nextNode => {
        connections.push({
          from: node,
          to: nextNode,
          weight: Math.random() * 0.5 + 0.5
        });
      });
    }

    nodesRef.current = nodes;
    connectionsRef.current = connections;
    layersRef.current = layers;

    return () => {
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = () => {
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      timeRef.current += 0.016; // ~60fps

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      const nodes = nodesRef.current;
      const connections = connectionsRef.current;

      // Update activations based on real-time processing stage
      if (isProcessing) {
        nodes.forEach(node => {
          if (processingStage === 'embedding' && node.layer === 0) {
            // Input layer: Light up during embedding generation
            node.activation = Math.min(1, node.activation + 0.08);
          } else if (processingStage === 'retrieval' && node.layer === 1) {
            // Hidden layer: Light up during Pinecone search
            node.activation = Math.min(1, node.activation + 0.1);
            // If we have retrieval results, use actual scores
            if (metadata?.retrieval_stats[node.index]) {
              node.activation = metadata.retrieval_stats[node.index].score;
            }
          } else if (processingStage === 'generation' && node.layer === 2) {
            // Output layer: Light up during GPT generation
            node.activation = Math.min(1, node.activation + 0.06);
          } else {
            // Fade out inactive layers during processing
            node.activation *= 0.92;
          }
        });
      } else {
        // Idle state: animated waves through network
        nodes.forEach((node, i) => {
          const pulse = Math.sin(timeRef.current * 2 + i * 0.3 + node.layer * 2) * 0.5 + 0.5;
          const layerDelay = Math.sin(timeRef.current * 0.5 + node.layer * 1) * 0.5 + 0.5;
          node.activation = pulse * layerDelay * 0.8;
        });
      }

      // Draw connections
      connections.forEach(conn => {
        const activation = (conn.from.activation + conn.to.activation) / 2;
        const alpha = activation * 0.5;

        ctx.strokeStyle = `rgba(102, 126, 234, ${alpha})`;
        ctx.lineWidth = 1.5 + activation * 2.5;
        ctx.beginPath();
        ctx.moveTo(conn.from.x * width, conn.from.y * height);
        ctx.lineTo(conn.to.x * width, conn.to.y * height);
        ctx.stroke();

        // Add glow to active connections
        if (activation > 0.5) {
          ctx.strokeStyle = `rgba(102, 126, 234, ${activation * 0.3})`;
          ctx.lineWidth = 4 + activation * 3;
          ctx.beginPath();
          ctx.moveTo(conn.from.x * width, conn.from.y * height);
          ctx.lineTo(conn.to.x * width, conn.to.y * height);
          ctx.stroke();
        }
      });

      // Draw nodes
      nodes.forEach(node => {
        const x = node.x * width;
        const y = node.y * height;
        const alpha = 0.2 + node.activation;

        // Outer glow (larger when active)
        const glowSize = node.radius * (2 + node.activation * 2);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowSize);
        gradient.addColorStop(0, `rgba(102, 126, 234, ${alpha})`);
        gradient.addColorStop(0.3, `rgba(118, 75, 162, ${alpha * 0.6})`);
        gradient.addColorStop(1, 'rgba(102, 126, 234, 0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, glowSize, 0, Math.PI * 2);
        ctx.fill();

        // Inner node (brighter when active)
        const innerGradient = ctx.createRadialGradient(x, y, 0, x, y, node.radius);
        innerGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.9})`);
        innerGradient.addColorStop(0.7, `rgba(102, 126, 234, ${alpha})`);
        innerGradient.addColorStop(1, `rgba(102, 126, 234, ${alpha * 0.8})`);

        ctx.fillStyle = innerGradient;
        ctx.beginPath();
        ctx.arc(x, y, node.radius, 0, Math.PI * 2);
        ctx.fill();

        // Highlight very active nodes with ring
        if (node.activation > 0.6) {
          ctx.strokeStyle = `rgba(255, 255, 255, ${node.activation * 0.7})`;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(x, y, node.radius + 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // Draw layer labels (always visible)
      const layers = layersRef.current;
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';

      layers.forEach((layer, idx) => {
        const isActive =
          (processingStage === 'embedding' && idx === 0) ||
          (processingStage === 'retrieval' && idx === 1) ||
          (processingStage === 'generation' && idx === 2);

        const x = width * 0.05;
        let y = layer.y * height;

        // Adjust text position based on layer
        if (idx === 0) {
          // Top layer: text above
          y -= 50;
        } else if (idx === 2) {
          // Bottom layer: text below
          y += 50;
        }

        // Brighter when active
        const alpha = isActive && isProcessing ? 0.95 : 0.5;
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.fillText(layer.name, x, y);
      });

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isProcessing, metadata, processingStage]);

  return (
    <div className="neural-network-viz">
      <canvas ref={canvasRef} />

      {metadata && !isProcessing && (
        <div className="network-stats">
          <div className="stat-item">
            <span className="stat-label">Embedding</span>
            <span className="stat-value">{metadata.embedding_stats.dimension} dims</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Retrieved</span>
            <span className="stat-value">{metadata.retrieval_stats.length} docs</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Generated</span>
            <span className="stat-value">{metadata.generation_stats.tokens} tokens</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Time</span>
            <span className="stat-value">{metadata.generation_stats.time_ms}ms</span>
          </div>
        </div>
      )}
    </div>
  );
}