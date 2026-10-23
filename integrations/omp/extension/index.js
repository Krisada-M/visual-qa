/**
 * Thin OMP command bridge. The actual QA work stays in the portable CLI.
 * Never runs arbitrary shell commands or bypasses authenticated boundaries.
 */
export default function registerVisualQa(pi) {
  pi.registerCommand('ui-qa', {
    description: 'Run the versioned Visual QA suite using the visual-qa skill',
    handler: async (args, ctx) => {
      const target = args.trim();
      if (!target) {
        ctx.ui.notify('Usage: /ui-qa <suite.json path>', 'info');
        return;
      }

      pi.sendMessage(
        {
          customType: 'visual-qa-run',
          content:
            'Use the installed visual-qa skill. Inspect the Visual QA repository and ' +
            'verify this suite manifest path before running it: ' +
            JSON.stringify(target) +
            '. Use the versioned batch CLI; preserve FRD, Figma, auth and security gates. ' +
            'Report only actual evidence and do not change implementation, merge or deploy.',
          display: true,
          attribution: 'user',
        },
        { triggerTurn: true }
      );
    },
  });
}
