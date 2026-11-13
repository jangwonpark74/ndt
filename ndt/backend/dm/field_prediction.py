"""Evaluate an observed source cell at actual GPS using its frozen model inputs."""
import math
from .simulation import model_for,validate_frozen_cell_inputs,cell_prediction
from .model_versions import CELL_UMA,PATTERN_UMA,RECEIVER_UMA
from .pattern_context import prepare_snapshot_patterns
from .polarization import validate_receiver_templates,prepare_polarization,template_orientation
from ..cell_assignments import validate_cell_power_change

class _FieldPredictor:
    def __init__(self,context):
        model=model_for(context)
        if model not in (CELL_UMA,PATTERN_UMA,RECEIVER_UMA) or context.get('model',model)!=model:
            raise ValueError('Field validation needs its original explicit source-cell model identity')
        validate_frozen_cell_inputs(context)
        if not isinstance(context.get('powers'),dict):raise ValueError('Frozen effective powers are missing')
        validate_cell_power_change(context['transmitters'],context['radioScenario']['payload'].get('radioBudgets'),effective_powers=context.get('powers'))
        self.assets=prepare_snapshot_patterns(context) if context.get('patternAssumptions') else None
        templates=[p['template'] for t in context['transmitters'] for p in t.get('ports',[{'template':t.get('template')}])]
        self.receiver=validate_receiver_templates(context['radioScenario']['payload'].get('receiver'),templates) if model==RECEIVER_UMA else None
        self.polarizations={id(t):prepare_polarization(template_orientation(t)) for t in templates} if self.receiver else None
        self.transmitters={t['id']:t for t in context['transmitters']};self.powers=context['powers']

    def at(self,identity,coordinates):
        if identity not in self.transmitters:raise ValueError('The observed cell is not assigned in the frozen source')
        if not isinstance(coordinates,(list,tuple)) or len(coordinates)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) for v in coordinates) or not -180<=coordinates[0]<=180 or not -90<=coordinates[1]<=90:
            raise ValueError('Provide finite observed WGS84 longitude and latitude')
        return cell_prediction(self.transmitters[identity],coordinates,self.powers[identity],pattern_assets=self.assets,receiver_model=self.receiver,polarizations=self.polarizations)

def prepare_field_predictor(context):return _FieldPredictor(context)
