import {
  CachedBeaconStateAllForks,
  CachedBeaconStateAltair,
  CachedBeaconStatePhase0,
  getAttesterSlashableIndices,
  processAttestationsAltair,
} from "@lodestar/state-transition";
import {ValidatorIndex, allForks, altair, phase0} from "@lodestar/types";
import {ForkName, WHISTLEBLOWER_REWARD_QUOTIENT} from "@lodestar/params";

type SubRewardValue = number; // All reward values should be integer

export type BlockRewards = {
  proposerIndex: ValidatorIndex;
  total: SubRewardValue;
  attestations: SubRewardValue;
  syncAggregate: SubRewardValue;
  proposerSlashings: SubRewardValue;
  attesterSlashings: SubRewardValue;
};

/**
 * Calculate total proposer block rewards given block and the beacon state of the same slot before the block is applied
 * Standard (Non MEV) rewards for proposing a block consists of:
 *  1) Including attestations from (beacon) committee
 *  2) Including attestations from sync committee
 *  3) Reporting slashable behaviours from proposer and attester
 */
export async function computeBlockRewards(
  block: allForks.BeaconBlock,
  state: CachedBeaconStateAllForks
): Promise<BlockRewards> {
  const fork = state.config.getForkName(block.slot);
  const blockAttestationReward =
    fork === ForkName.phase0
      ? computeBlockAttestationRewardPhase0(block as phase0.BeaconBlock, state as CachedBeaconStatePhase0)
      : computeBlockAttestationRewardAltair(block as altair.BeaconBlock, state as CachedBeaconStateAltair);
  const syncAggregateReward = computeSyncAggregateReward(block as altair.BeaconBlock, state as CachedBeaconStateAltair);
  const blockProposerSlashingReward = computeBlockProposerSlashingReward(block, state);
  const blockAttesterSlashingReward = computeBlockAttesterSlashingReward(block, state);

  const total =
    blockAttestationReward + syncAggregateReward + blockProposerSlashingReward + blockAttesterSlashingReward;

  return {
    proposerIndex: block.proposerIndex,
    total,
    attestations: blockAttestationReward,
    syncAggregate: syncAggregateReward,
    proposerSlashings: blockProposerSlashingReward,
    attesterSlashings: blockAttesterSlashingReward,
  };
}

/**
 * TODO: Calculate rewards received by block proposer for incuding attestations.
 */
function computeBlockAttestationRewardPhase0(
  _block: phase0.BeaconBlock,
  _state: CachedBeaconStatePhase0
): SubRewardValue {
  throw new Error("Unsupported fork! Block attestation reward calculation is not yet available in phase0");
}

/**
 * Calculate rewards received by block proposer for incuding attestations since Altair.
 * Reuses `processAttestationsAltair()`. Has dependency on RewardCache
 */
function computeBlockAttestationRewardAltair(
  block: altair.BeaconBlock,
  state: CachedBeaconStateAltair
): SubRewardValue {
  const fork = state.config.getForkSeq(block.slot);
  const {attestations} = block.body;

  processAttestationsAltair(fork, state, attestations, false);

  return state.proposerRewards.attestations;
}

function computeSyncAggregateReward(block: altair.BeaconBlock, state: CachedBeaconStateAltair): SubRewardValue {
  if (block.body.syncAggregate !== undefined) {
    const {syncCommitteeBits} = block.body.syncAggregate;
    const {syncProposerReward} = state.epochCtx;

    return syncCommitteeBits.getTrueBitIndexes().length * Math.floor(syncProposerReward); // syncProposerReward should already be integer
  } else {
    return 0; // phase0 block does not have syncAggregate
  }
}
/**
 * Calculate rewards received by block proposer for include proposer slashings.
 * All proposer slashing rewards go to block proposer and none to whistleblower as of Deneb
 */
function computeBlockProposerSlashingReward(
  block: allForks.BeaconBlock,
  state: CachedBeaconStateAllForks
): SubRewardValue {
  let proposerSlashingReward = 0;

  for (const proposerSlashing of block.body.proposerSlashings) {
    const offendingProposerIndex = proposerSlashing.signedHeader1.message.proposerIndex;
    const offendingProposerBalance = state.validators.get(offendingProposerIndex).effectiveBalance;

    proposerSlashingReward += Math.floor(offendingProposerBalance / WHISTLEBLOWER_REWARD_QUOTIENT);
  }

  return proposerSlashingReward;
}

/**
 * Calculate rewards received by block proposer for include attester slashings.
 * All attester slashing rewards go to block proposer and none to whistleblower as of Deneb
 */
function computeBlockAttesterSlashingReward(
  block: allForks.BeaconBlock,
  state: CachedBeaconStateAllForks
): SubRewardValue {
  let attesterSlashingReward = 0;

  for (const attesterSlashing of block.body.attesterSlashings) {
    for (const offendingAttesterIndex of getAttesterSlashableIndices(attesterSlashing)) {
      const offendingAttesterBalance = state.validators.get(offendingAttesterIndex).effectiveBalance;

      attesterSlashingReward += Math.floor(offendingAttesterBalance / WHISTLEBLOWER_REWARD_QUOTIENT);
    }
  }

  return attesterSlashingReward;
}
