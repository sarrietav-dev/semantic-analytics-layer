import { InvalidRegistrationError } from "./errors";
import type {
  AnalyticsModule,
  DimensionDefinition,
  MetricDefinition,
  PublicDefinitionView,
} from "./types";

interface RegisteredDefinition<T> {
  definition: T;
  module: AnalyticsModule;
}

export class AnalyticsRegistry {
  private readonly modules = new Map<string, AnalyticsModule>();
  private readonly metrics = new Map<
    string,
    RegisteredDefinition<MetricDefinition>
  >();
  private readonly dimensions = new Map<
    string,
    RegisteredDefinition<DimensionDefinition>
  >();

  register(module: AnalyticsModule): this {
    if (this.modules.has(module.id)) {
      throw new InvalidRegistrationError(
        `Module ${module.id} is already registered`,
      );
    }

    for (const definition of module.definitions) {
      if (
        this.metrics.has(definition.name) ||
        this.dimensions.has(definition.name)
      ) {
        throw new InvalidRegistrationError(
          `Definition ${definition.name} is already registered`,
        );
      }

      if (definition.kind === "metric") {
        this.metrics.set(definition.name, { definition, module });
      } else {
        this.dimensions.set(definition.name, { definition, module });
      }
    }

    this.modules.set(module.id, module);
    return this;
  }

  assertValid(): void {
    for (const { definition } of this.metrics.values()) {
      for (const dimension of definition.supportedDimensions) {
        if (!this.dimensions.has(dimension)) {
          throw new InvalidRegistrationError(
            `Metric ${definition.name} references unknown dimension ${dimension}`,
          );
        }
      }
    }

    for (const { definition, module } of this.dimensions.values()) {
      if (!module.resolveDimensionMembers) {
        throw new InvalidRegistrationError(
          `Dimension owner ${module.id} must resolve members for ${definition.name}`,
        );
      }
    }
  }

  getMetric(name: string): RegisteredDefinition<MetricDefinition> | undefined {
    return this.metrics.get(name);
  }

  getDimension(
    name: string,
  ): RegisteredDefinition<DimensionDefinition> | undefined {
    return this.dimensions.get(name);
  }

  getModule(id: string): AnalyticsModule | undefined {
    return this.modules.get(id);
  }

  publicDefinitions(): PublicDefinitionView[] {
    const definitions: PublicDefinitionView[] = [];

    for (const module of this.modules.values()) {
      for (const definition of module.definitions) {
        if (definition.kind === "metric") {
          definitions.push({
            kind: definition.kind,
            name: definition.name,
            label: definition.label,
            description: definition.description,
            type: definition.type,
            supportedDimensions: [...definition.supportedDimensions],
            supportedGranularities: [...definition.supportedGranularities],
            emptyValue: definition.emptyValue,
            owner: module.id,
          });
        } else {
          definitions.push({
            kind: definition.kind,
            name: definition.name,
            label: definition.label,
            description: definition.description,
            type: definition.type,
            filterOperators: [...definition.filterOperators],
            owner: module.id,
          });
        }
      }
    }

    return definitions.sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }
}
