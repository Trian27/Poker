import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { marketplaceApi } from '../api';
import { useAuth } from '../auth-context';
import type { CoinPurchaseIntent, MarketplaceCoinPackage, SkinCatalogItem } from '../types';
import './FeatureHub.css';
import { getApiErrorMessage } from "../utils/error";

export const MarketplacePage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [goldCoins, setGoldCoins] = useState(0);
  const [items, setItems] = useState<SkinCatalogItem[]>([]);
  const [packages, setPackages] = useState<MarketplaceCoinPackage[]>([]);
  const [lastIntent, setLastIntent] = useState<CoinPurchaseIntent | null>(null);
  const [error, setError] = useState('');

  const loadData = async () => {
    try {
      const [balanceData, itemsData, packageData] = await Promise.all([
        marketplaceApi.getGoldBalance(),
        marketplaceApi.getItems(),
        marketplaceApi.getCoinPackages(),
      ]);
      setGoldCoins(Number(balanceData.gold_coins || 0));
      setItems(itemsData);
      setPackages(packageData);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load marketplace'));
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const buySkin = async (skinId: number) => {
    try {
      const result = await marketplaceApi.buySkin(skinId);
      setGoldCoins(Number(result.gold_coins || 0));
      await loadData();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to buy skin'));
    }
  };

  const createIntent = async (packageKey: string) => {
    try {
      const intent = await marketplaceApi.createCoinPurchaseIntent(packageKey);
      setLastIntent(intent);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to create purchase intent'));
    }
  };

  const completeIntentForTesting = async () => {
    if (!lastIntent) {
      return;
    }
    try {
      await marketplaceApi.completeCoinPurchaseIntentAsAdmin(lastIntent.id);
      setLastIntent(null);
      await loadData();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to complete purchase'));
    }
  };

  return (
    <div className="feature-page">
      <div className="feature-header">
        <h1>Marketplace</h1>
        <button className="secondary" onClick={() => navigate('/dashboard')}>Back</button>
      </div>

      {error && <div className="feature-card">{error}</div>}

      <div className="feature-grid">
        <div className="feature-card">
          <h3>Gold Coins</h3>
          <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{goldCoins}</div>
          <div className="feature-meta">Gold coins are universal and separate from game chips.</div>
          <div className="feature-meta">Target peg: 1 gold coin is roughly equal to $0.01 USD.</div>
        </div>

        <div className="feature-card">
          <h3>Buy Gold Coins</h3>
          <div className="coin-packages">
            {packages.map((pkg) => (
              <button key={pkg.package_key} type="button" onClick={() => createIntent(pkg.package_key)}>
                {pkg.gold_coins} GC (${(pkg.usd_cents / 100).toFixed(2)})
              </button>
            ))}
          </div>
          <div className="feature-meta" style={{ marginTop: 8 }}>
            Payment integration scaffolded (intent creation). Provider checkout wiring is next.
          </div>
          {lastIntent && (
            <div className="feature-meta" style={{ marginTop: 8 }}>
              Intent #{lastIntent.id} created ({lastIntent.package_key}, status={lastIntent.status})
            </div>
          )}
          {user?.is_admin && lastIntent && (
            <button type="button" style={{ marginTop: 8 }} onClick={completeIntentForTesting}>
              Admin Test: Complete Intent
            </button>
          )}
        </div>

        <div className="feature-card" style={{ gridColumn: '1 / -1' }}>
          <h3>Skin Marketplace</h3>
          <div className="feature-meta" style={{ marginBottom: 8 }}>
            Community creators receive a 5% royalty tracked in USD cents and can request cash payouts.
          </div>
          <div className="feature-grid">
            {items.map((item) => (
              <div key={item.id} className="feature-card">
                <h3>{item.name}</h3>
                <div className="feature-meta">Category: {item.category}</div>
                <div className="feature-meta">Price: {item.price_gold_coins} GC</div>
                <p>{item.description || 'No description'}</p>
                <button type="button" onClick={() => buySkin(item.id)}>
                  Buy
                </button>
              </div>
            ))}
            {items.length === 0 && <div className="feature-meta">No marketplace skins yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
};
