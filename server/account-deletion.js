'use strict';

/**
 * Permanently delete an authenticated ECHO account in one SQL transaction.
 * Paid transaction records remain without a link to the user so the payment
 * provider's order identifiers can still be reconciled and deduplicated.
 */
async function initialize(pool) {
  // Existing payment schemas create account_id NOT NULL. Payment receipts
  // must outlive a deleted profile without keeping the account relation.
  await pool.query('ALTER TABLE echo_vk_payments ALTER COLUMN account_id DROP NOT NULL');
  await pool.query('ALTER TABLE echo_robokassa_orders ALTER COLUMN account_id DROP NOT NULL');
}

async function deleteAccount(pool, tokenHash) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the account row: new FK-based purchases cannot be committed after
    // deletion, and concurrent deletion requests serialize here.
    const result = await client.query(
      `SELECT a.id FROM echo_auth_sessions s
       JOIN echo_accounts a ON a.id=s.account_id
       WHERE s.token_hash=$1 AND s.expires_at>NOW()
       FOR UPDATE OF a`,
      [tokenHash]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return null;
    }
    const id = String(result.rows[0].id);
    const scoreIdentity = 'account:' + id;
    // Retain paid receipts detached from the user to preserve uniqueness
    // and payment reconciliation. Pending Robokassa orders cannot grant cards.
    await client.query(
      `UPDATE echo_vk_payments SET account_id=NULL, intent_id=NULL
       WHERE account_id=$1`, [id]);
    await client.query(
      `UPDATE echo_robokassa_orders
       SET account_id=NULL,
           status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END
       WHERE account_id=$1`, [id]);

    // User-owned data without FK to the account, or with a restrictive FK.
    await client.query('DELETE FROM echo_pack_openings WHERE account_id=$1', [id]);
    await client.query('DELETE FROM echo_hero_collection WHERE account_id=$1::text', [id]);
    await client.query('DELETE FROM echo_wallets WHERE profile_id=$1::text', [id]);
    await client.query('DELETE FROM echo_daily_activity WHERE profile_id=$1::text', [id]);
    await client.query('DELETE FROM echo_daily_quest_claims WHERE profile_id=$1::text', [id]);
    await client.query('DELETE FROM echo_daily_video_bonus WHERE profile_id=$1::text', [id]);
    await client.query('DELETE FROM echo_round_account_awards WHERE account_id=$1', [id]);
    await client.query('DELETE FROM echo_round_scores WHERE profile_id=$1', [scoreIdentity]);
    await client.query('DELETE FROM echo_coin_ledger WHERE profile_id=$1', [scoreIdentity]);
    // Deleting the account cascades its auth sessions, free packs, partner
    // quest codes and VK payment intents (already detached above).
    const deleted = await client.query('DELETE FROM echo_accounts WHERE id=$1 RETURNING id', [id]);
    if (deleted.rowCount !== 1) throw new Error('Account deletion lost its account lock');
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {initialize, deleteAccount};
