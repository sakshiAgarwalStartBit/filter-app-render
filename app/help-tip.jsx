import { useId } from "react";

export function HelpTip({ text }) {
  const id = useId();
  return (
    <>
      <s-icon type="info" interestFor={id}></s-icon>
      <s-tooltip id={id}>{text}</s-tooltip>
    </>
  );
}

export function SectionHeading({ text, tip }) {
  return (
    <s-stack direction="inline" gap="tight" alignItems="center">
      <s-text type="strong">{text}</s-text>
      <HelpTip text={tip} />
    </s-stack>
  );
}

export function HeadingWithTip({ children, tip, paddingBlockEnd = "small-200" }) {
  return (
    <s-box paddingBlockEnd={paddingBlockEnd}>
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-heading>{children}</s-heading>
        <HelpTip text={tip} />
      </s-stack>
    </s-box>
  );
}
