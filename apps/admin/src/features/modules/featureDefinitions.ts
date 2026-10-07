import catalog from "../../../../../contracts/feature-catalog.v1.json";
import type { FeatureDefinition } from "./contracts";

// Tek kaynak paylaşılan sözleşmedir. Çalışma zamanı doğrulaması sözleşme testinde yapılır.
export const featureCatalogVersion = catalog.catalogVersion;
export const featureDefinitions = catalog.definitions as FeatureDefinition[];
