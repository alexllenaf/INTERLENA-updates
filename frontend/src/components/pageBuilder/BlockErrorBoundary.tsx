import React from "react";

type Props = {
  blockId: string;
  blockType: string;
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

export class BlockErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[BlockErrorBoundary] Block "${this.props.blockId}" (type: ${this.props.blockType}) crashed:`,
      error,
      info.componentStack
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="block-error-placeholder"
          title={`Error en bloque ${this.props.blockType}: ${this.state.error.message}`}
        >
          <span className="block-error-icon">⚠</span>
          <span className="block-error-label">
            Bloque <em>{this.props.blockType}</em> no disponible
          </span>
          <span className="block-error-hint">
            Revisa la consola para más detalles
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}
