import { AgentInstallControl } from "../../launcher/agent-install-control";
import { quickAgentChoices, toggleQuickAgent } from "../../settings/quick-agent-choices";
import { ConfigGroup, ConfigRow, ToggleRow } from "../controls/config-row";

export function QuickAgentsSection() {
  const choices = quickAgentChoices();
  const pinned = choices.filter((choice) => choice.pinned).length;

  return (
    <section aria-label="Quick agents">
      <ConfigGroup label="Quick agents" />
      <ConfigRow label="Pinned agents" desc="In quick launch and the checkout menu">
        <span class="cfg-row__desc">{pinned}</span>
      </ConfigRow>
      <div data-quick-agent-choices>
        {choices.map((choice) => {
          const offered = choice.offer !== undefined && choice.offer.kind !== "none";
          return (
            <ToggleRow
              key={choice.id}
              label={choice.label}
              desc={offered ? undefined : (choice.blocked ?? undefined)}
              note={
                offered ? <AgentInstallControl agentId={choice.id} label={choice.label} /> : null
              }
              checked={choice.pinned}
              disabled={!choice.toggleable}
              onToggle={() => toggleQuickAgent(choice.id)}
            />
          );
        })}
      </div>
    </section>
  );
}
