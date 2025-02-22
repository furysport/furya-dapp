import { ScrollView, Target } from "@nandorojo/anchor";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";

import useSelectedWallet from "../../hooks/useSelectedWallet";

import { BrandText } from "@/components/BrandText";
import { ScreenContainer } from "@/components/ScreenContainer";
import { NFTMainInfo } from "@/components/nftDetails/NFTMainInfo";
import { SpacerColumn } from "@/components/spacer";
import { Tabs } from "@/components/tabs/Tabs";
import { initialToastError, useFeedbacks } from "@/context/FeedbacksProvider";
import { Wallet } from "@/context/WalletsProvider";
import { NftMarketplaceClient } from "@/contracts-clients/nft-marketplace/NftMarketplace.client";
import { NFTVault__factory } from "@/evm-contracts-clients/teritori-nft-vault/NFTVault__factory";
import { useMintEnded } from "@/hooks/collection/useMintEnded";
import { useCancelNFTListing } from "@/hooks/useCancelNFTListing";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useMaxResolution } from "@/hooks/useMaxResolution";
import { useNFTInfo } from "@/hooks/useNFTInfo";
import { useSellNFT } from "@/hooks/useSellNFT";
import {
  getCollectionId,
  mustGetCosmosNetwork,
  mustGetEthereumNetwork,
  NetworkKind,
  parseNftId,
} from "@/networks";
import { getKeplrSigningCosmWasmClient } from "@/networks/signer";
import { getMetaMaskEthereumSigner } from "@/utils/ethereum";
import { ScreenFC, useAppNavigation } from "@/utils/navigation";
import { NFTInfo } from "@/utils/types/nft";

const Content: React.FC<{
  id: string;
}> = ({ id }) => {
  const [selectedTab, setSelectedTab] =
    useState<keyof typeof screenTabItems>("main");
  const { setToastError, setLoadingFullScreen } = useFeedbacks();
  const isMobile = useIsMobile();
  const wallet = useSelectedWallet();
  const { info, refresh, notFound } = useNFTInfo(id, wallet?.userId);
  const { width } = useMaxResolution({ responsive: true, noMargin: true });
  const [network, mintContractAddress] = parseNftId(id);
  const collectionId = getCollectionId(network?.id, mintContractAddress);
  const mintEnded = useMintEnded(collectionId);
  const showMarketplace =
    (network?.secondaryDuringMintList || []).includes(mintContractAddress) ||
    (mintEnded !== undefined && mintEnded);

  const screenTabItems = {
    main: {
      name: "Main info",
      scrollTo: "main-info",
    },
    price: {
      name: "Price history",
      scrollTo: "price-history",
      disabled: !showMarketplace,
    },
    activity: {
      name: "Activity",
      scrollTo: "activity",
    },
    more: {
      name: "More from collection",
      disabled: true,
    },
  };

  // Query the Vault client to buy the NFT and returns the transaction reply
  const handleBuy = useCallback(async () => {
    if (!wallet?.connected || !wallet.address || !info?.nftAddress) {
      return;
    }

    let buyFunc: CallableFunction | null = null;
    switch (network?.kind) {
      case NetworkKind.Cosmos:
        buyFunc = teritoriBuy;
        break;
      case NetworkKind.Ethereum:
        buyFunc = ethereumBuy;
        break;
    }

    if (!buyFunc) {
      setToastError({
        title: "Error",
        message: `Unsupported network kind ${network?.kind}`,
      });
      return;
    }

    setToastError(initialToastError);
    try {
      const txHash = await buyFunc(wallet, info);

      console.log("buy", txHash);
      await refresh();

      return txHash;
    } catch (e) {
      console.error(e);
      if (e instanceof Error) {
        setToastError({
          title: "Failed to buy NFT",
          message: e.message,
        });
      }
    }
  }, [info, network?.kind, refresh, setToastError, wallet]);

  const sell = useSellNFT(network?.kind);

  const handleSell = useCallback(
    async (price: string, denom: string | undefined) => {
      if (!info) {
        return;
      }
      const txHash = await sell(info.nftAddress, info.tokenId, price, denom);
      console.log("txHash:", txHash);
      await refresh();
      return txHash;
    },
    [info, sell, refresh],
  );

  const cancelListing = useCancelNFTListing(
    network?.id,
    info?.nftAddress || "",
    info?.tokenId || "",
  );

  const handleCancelListing = useCallback(async () => {
    setLoadingFullScreen(true);
    try {
      await cancelListing();
      await refresh();
      setLoadingFullScreen(false);
    } catch (e) {
      setLoadingFullScreen(false);
      throw e;
    }
  }, [cancelListing, refresh, setLoadingFullScreen]);

  const updatePrice = useCallback(
    async (newPrice: { amount: string; denom: string }) => {
      setLoadingFullScreen(true);
      try {
        if (!info) {
          throw new Error("No NFT info");
        }
        const sender = wallet?.address;
        if (!sender) {
          throw new Error("No wallet connected");
        }
        const client = await getKeplrSigningCosmWasmClient(info.networkId);
        if (!client) {
          throw new Error("Failed to get client");
        }
        const cosmosNetwork = mustGetCosmosNetwork(info.networkId);
        if (!cosmosNetwork.vaultContractAddress) {
          throw new Error("network not supported");
        }
        const vaultClient = new NftMarketplaceClient(
          client,
          sender,
          cosmosNetwork.vaultContractAddress,
        );
        await vaultClient.updatePrice({
          nftContractAddr: info.nftAddress,
          nftTokenId: info.tokenId,
          amount: newPrice.amount,
          denom: newPrice.denom,
        });
        await refresh();
        setLoadingFullScreen(false);
      } catch (e) {
        setLoadingFullScreen(false);
        throw e;
      }
    },
    [info, refresh, setLoadingFullScreen, wallet?.address],
  );

  if (
    ![NetworkKind.Cosmos, NetworkKind.Ethereum].includes(
      network?.kind || NetworkKind.Unknown,
    )
  ) {
    return (
      <View style={{ alignItems: "center", width: "100%", marginTop: 40 }}>
        <BrandText>Network not supported</BrandText>
      </View>
    );
  } else if (notFound) {
    return (
      <View style={{ alignItems: "center", width: "100%", marginTop: 40 }}>
        <BrandText>NFT not found</BrandText>
      </View>
    );
  }

  // TODO: Reuse this ScrollView pattern (ScrollView + View just bellow) in other Screens to provide a ScreenView (One per screen) width centered scrolling content with fixed max width. And remove it from ScreenContainer
  else {
    return (
      <View style={{ flex: 1 }}>
        <ScrollView
          style={{ width: "100%" }}
          stickyHeaderIndices={Platform.OS === "web" ? [0] : undefined} // value [0] makes component unscrollable on mobile
          contentContainerStyle={{
            width: "100%",
            alignItems: "center",
          }}
        >
          {!isMobile && (
            <Tabs
              items={screenTabItems}
              selected={selectedTab}
              style={{
                height: 60,
                width,
                alignItems: "flex-end",
                backgroundColor: "black",
              }}
              onSelect={setSelectedTab}
            />
          )}

          {!isMobile && (
            <Target name="main-info">
              <SpacerColumn size={6} />
            </Target>
          )}

          <NFTMainInfo
            nftId={id}
            nftInfo={info || undefined}
            buy={handleBuy}
            sell={handleSell}
            cancelListing={handleCancelListing}
            updatePrice={updatePrice}
            showMarketplace={showMarketplace}
          />
          <SpacerColumn size={6} />
        </ScrollView>
      </View>
    );
  }
};

export const NFTDetailScreen: ScreenFC<"NFTDetail"> = ({
  route: {
    params: { id },
  },
}) => {
  // needed for emoji
  id = decodeURIComponent(id);

  const [network] = parseNftId(id);
  const { info } = useNFTInfo(id);
  const navigation = useAppNavigation();

  useEffect(() => {
    navigation.setOptions({
      title: `Teritori - NFT: ${info?.name}`,
    });
  }, [info?.name, navigation]);

  return (
    <ScreenContainer
      forceNetworkId={network?.id}
      footerChildren={<></>}
      responsive
      fullWidth
      noScroll
      noMargin
      onBackPress={() =>
        navigation.canGoBack()
          ? navigation.goBack()
          : info?.collectionId
            ? navigation.navigate("Collection", { id: info?.collectionId })
            : navigation.navigate("Marketplace")
      }
    >
      <Content key={id} id={id} />
    </ScreenContainer>
  );
};

const teritoriBuy = async (wallet: Wallet, info: NFTInfo) => {
  const network = mustGetCosmosNetwork(info.networkId);
  if (!network.vaultContractAddress) {
    throw new Error("network not supported");
  }
  const signingCosmwasmClient = await getKeplrSigningCosmWasmClient(network.id);
  const signingVaultClient = new NftMarketplaceClient(
    signingCosmwasmClient,
    wallet.address,
    network.vaultContractAddress,
  );
  const tx = await signingVaultClient.buy(
    { nftContractAddr: info.nftAddress, nftTokenId: info.tokenId },
    "auto",
    undefined,
    [
      {
        amount: info.price,
        denom: info.priceDenom,
      },
    ],
  );
  return tx.transactionHash;
};

const ethereumBuy = async (wallet: Wallet, nftInfo: NFTInfo) => {
  const network = mustGetEthereumNetwork(nftInfo.networkId);
  const signer = await getMetaMaskEthereumSigner(network, wallet.address);
  if (!signer) {
    throw Error("Unable to get signer");
  }

  const vaultClient = NFTVault__factory.connect(
    network.vaultContractAddress,
    signer,
  );

  const { maxFeePerGas, maxPriorityFeePerGas } = await signer.getFeeData();
  const tx = await vaultClient.buyNFT(nftInfo.nftAddress, nftInfo.tokenId, {
    maxFeePerGas: maxFeePerGas?.toNumber(),
    maxPriorityFeePerGas: maxPriorityFeePerGas?.toNumber(),
    value: nftInfo.price,
  });

  await tx.wait();

  return tx.hash;
};
