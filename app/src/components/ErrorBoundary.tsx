import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * 흰 화면 방지용 에러 바운더리.
 *
 * World App 웹뷰에서는 사용자/OS 가 정보를 얻을 방법이 없으므로,
 * 예기치 못한 오류도 최소한 "무엇이 잘못됐는지 + 어떻게 해야 하는지"를 보여줘야 한다.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 콘솔에 남겨두면 World App 디버깅 창에서 바로 확인 가능하다.
    console.error("[WorldInheritance] unhandled error:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ padding: "24px", fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
        <h1 style={{ fontSize: "18px", margin: "0 0 8px" }}>Something went wrong</h1>
        <p style={{ margin: "0 0 12px", color: "#555" }}>
          The app hit an unexpected error. Reloading usually clears it.
        </p>
        <pre
          style={{
            padding: "12px",
            background: "#f5f5f5",
            borderRadius: "8px",
            overflowX: "auto",
            fontSize: "12px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: "16px",
            padding: "10px 16px",
            borderRadius: "8px",
            border: "1px solid #ccc",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
